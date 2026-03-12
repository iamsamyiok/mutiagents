/**
 * 知识库功能模块
 * 功能：文档管理、向量存储、语义检索
 */

// ================= 知识库数据库管理 =================
let kbDB = null;
const DB_NAME = 'SMAW_KnowledgeBase';
const DB_VERSION = 1;

// 初始化知识库数据库
async function initKnowledgeBaseDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error('知识库数据库打开失败:', event.target.error);
            reject(event.target.error);
        };

        request.onsuccess = (event) => {
            kbDB = event.target.result;
            console.log('知识库数据库初始化成功');
            resolve(kbDB);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // 创建文档存储
            if (!db.objectStoreNames.contains('documents')) {
                const documentStore = db.createObjectStore('documents', { keyPath: 'id' });
                documentStore.createIndex('uploadTime', 'uploadTime', { unique: false });
            }

            // 创建向量存储
            if (!db.objectStoreNames.contains('chunks')) {
                const chunkStore = db.createObjectStore('chunks', { keyPath: 'id' });
                chunkStore.createIndex('documentId', 'documentId', { unique: false });
            }
        };
    });
}

// ================= 文本分块 =================
function chunkText(text, chunkSize = 512, overlap = 100) {
    const chunks = [];
    let start = 0;
    
    while (start < text.length) {
        let end = start + chunkSize;
        
        // 尝试在句子边界处分割
        if (end < text.length) {
            const lastSentenceEnd = Math.max(
                text.lastIndexOf('。', end),
                text.lastIndexOf('！', end),
                text.lastIndexOf('？', end),
                text.lastIndexOf('；', end),
                text.lastIndexOf('\n', end)
            );
            
            if (lastSentenceEnd > start + chunkSize / 2) {
                end = lastSentenceEnd + 1;
            }
        }
        
        chunks.push(text.slice(start, end));
        start = end - overlap;
    }
    
    return chunks;
}

// ================= 文档处理 =================
async function uploadDocument(file, embeddingConfig) {
    if (!kbDB) {
        await initKnowledgeBaseDB();
    }
    
    // 读取文件内容
    const content = await file.text();
    
    // 创建文档记录
    const docId = 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const document = {
        id: docId,
        name: file.name,
        size: file.size,
        type: file.type,
        content: content,
        uploadTime: Date.now(),
        chunkCount: 0
    };
    
    // 分块处理
    const chunks = chunkText(content, 512, 100);
    document.chunkCount = chunks.length;
    
    // 存储文档
    const transaction = kbDB.transaction(['documents'], 'readwrite');
    const documentStore = transaction.objectStore('documents');
    documentStore.add(document);
    
    // 批量生成嵌入向量并存储
    for (let i = 0; i < chunks.length; i++) {
        const chunkId = docId + '_chunk_' + i;
        
        try {
            // 生成嵌入向量
            const embedding = await generateEmbedding(chunks[i], embeddingConfig);
            
            const chunk = {
                id: chunkId,
                documentId: docId,
                index: i,
                content: chunks[i],
                embedding: embedding,
                createdAt: Date.now()
            };
            
            const chunkTransaction = kbDB.transaction(['chunks'], 'readwrite');
            const chunkStore = chunkTransaction.objectStore('chunks');
            chunkStore.add(chunk);
            
            await new Promise((resolve, reject) => {
                chunkTransaction.oncomplete = resolve;
                chunkTransaction.onerror = reject;
            });
        } catch (err) {
            console.error(`分块 ${i} 向量化失败:`, err);
            // 继续处理其他分块
        }
    }
    
    return document;
}

// ================= 嵌入API调用 =================
async function generateEmbedding(text, config) {
    if (!config || !config.apiKey) {
        throw new Error('嵌入API未配置');
    }
    
    const response = await fetch(config.baseUrl + '/embeddings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
            model: config.model,
            input: text
        })
    });
    
    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const errorMessage = errorData?.error?.message || response.statusText;
        throw new Error(`嵌入API调用失败 (${response.status}): ${errorMessage}`);
    }
    
    const data = await response.json();
    return data.data[0].embedding;
}

// ================= 语义检索 =================
async function searchKnowledge(query, config, topK = 3, threshold = 0.7) {
    if (!kbDB) {
        await initKnowledgeBaseDB();
    }
    
    // 生成查询向量
    const queryEmbedding = await generateEmbedding(query, config);
    
    // 获取所有向量
    const transaction = kbDB.transaction(['chunks'], 'readonly');
    const chunkStore = transaction.objectStore('chunks');
    const request = chunkStore.getAll();
    
    const chunks = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    
    // 计算相似度
    const results = chunks.map(chunk => {
        const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
        return {
            ...chunk,
            similarity: similarity
        };
    });
    
    // 过滤并排序
    const filtered = results.filter(r => r.similarity >= threshold);
    const sorted = filtered.sort((a, b) => b.similarity - a.similarity);
    
    return sorted.slice(0, topK);
}

// 余弦相似度计算
function cosineSimilarity(vec1, vec2) {
    if (vec1.length !== vec2.length) {
        throw new Error('向量长度不匹配');
    }
    
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
        dotProduct += vec1[i] * vec2[i];
        norm1 += vec1[i] * vec1[i];
        norm2 += vec2[i] * vec2[i];
    }
    
    if (norm1 === 0 || norm2 === 0) {
        return 0;
    }
    
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

// ================= 文档管理 =================
async function getAllDocuments() {
    if (!kbDB) {
        await initKnowledgeBaseDB();
    }
    
    const transaction = kbDB.transaction(['documents'], 'readonly');
    const documentStore = transaction.objectStore('documents');
    const request = documentStore.getAll();
    
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function deleteDocument(docId) {
    if (!kbDB) {
        await initKnowledgeBaseDB();
    }
    
    // 删除文档
    const docTransaction = kbDB.transaction(['documents'], 'readwrite');
    const docStore = docTransaction.objectStore('documents');
    docStore.delete(docId);
    
    // 删除相关分块
    const chunkTransaction = kbDB.transaction(['chunks'], 'readwrite');
    const chunkStore = chunkTransaction.objectStore('chunks');
    const index = chunkStore.index('documentId');
    const range = IDBKeyRange.only(docId);
    
    const request = index.openCursor(range);
    const deletePromises = [];
    
    request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
            deletePromises.push(cursor.delete());
            cursor.continue();
        }
    };
    
    await new Promise((resolve, reject) => {
        chunkTransaction.oncomplete = resolve;
        chunkTransaction.onerror = reject;
    });
}

async function clearKnowledgeBase() {
    if (!kbDB) {
        await initKnowledgeBaseDB();
    }
    
    const transaction = kbDB.transaction(['documents', 'chunks'], 'readwrite');
    transaction.objectStore('documents').clear();
    transaction.objectStore('chunks').clear();
    
    return new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = reject;
    });
}

// ================= 为智能体检索知识 =================
async function retrieveKnowledgeForAgent(query, agentId) {
    try {
        // 获取知识库配置
        const config = JSON.parse(localStorage.getItem('smaw_config') || '{}');
        const kbConfig = config.knowledgeBase || {};

        if (!kbConfig.enabled || !kbConfig.baseUrl || !kbConfig.apiKey) {
            console.log('知识库未启用或配置不完整，跳过检索');
            return '';
        }

        // 检查是否有为该智能体配置的知识库
        const agentKnowledgeConfig = kbConfig.agentKnowledge?.[agentId];
        if (agentKnowledgeConfig && !agentKnowledgeConfig.enabled) {
            console.log(`智能体 ${agentId} 未启用知识库检索`);
            return '';
        }

        // 获取智能体库
        const agentLibrary = JSON.parse(localStorage.getItem('smaw_agent_library') || '[]');
        const agent = agentLibrary.find(a => a.id === agentId);

        // 构建检索配置
        const embeddingConfig = {
            baseUrl: kbConfig.baseUrl,
            apiKey: kbConfig.apiKey,
            model: kbConfig.model || 'text-embedding-ada-002'
        };

        const topK = agentKnowledgeConfig?.topK || kbConfig.topK || 3;
        const threshold = agentKnowledgeConfig?.threshold || kbConfig.threshold || 0.7;

        // 检索知识
        const results = await searchKnowledge(query, embeddingConfig, topK, threshold);

        if (results.length === 0) {
            console.log('未找到相关知识');
            return '';
        }

        // 格式化检索结果
        let knowledgeText = '';
        results.forEach((result, index) => {
            knowledgeText += `\n\n[知识片段 ${index + 1}，相似度: ${(result.similarity * 100).toFixed(1)}%]\n${result.content}`;
        });

        console.log(`检索到 ${results.length} 条相关知识`);
        return knowledgeText;

    } catch (error) {
        console.error('知识库检索失败:', error);
        return '';
    }
}

// ================= 导出模块 =================
window.KnowledgeBaseModule = {
    init: initKnowledgeBaseDB,
    uploadDocument,
    searchKnowledge,
    getAllDocuments,
    deleteDocument,
    clearKnowledgeBase,
    retrieveKnowledgeForAgent
};

// 同时将retrieveKnowledgeForAgent函数暴露到全局作用域，以便在index.html中调用
window.retrieveKnowledgeForAgent = retrieveKnowledgeForAgent;