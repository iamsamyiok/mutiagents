// 微工作流引擎 - 服务器同步服务
// 端口: 15377

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 15377;
const DATA_FILE = path.join(__dirname, 'server-data.json');

// 中间件
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 加载数据
let serverData = {
    config: null,
    history: [],
    agents: [],
    workflows: [],
    version: new Date().toISOString()
};

// 从文件加载数据
function loadDataFromFile() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            serverData = JSON.parse(data);
            console.log('✓ 已从文件加载服务器数据');
        } else {
            console.log('✓ 数据文件不存在，使用默认配置');
        }
    } catch (err) {
        console.error('✗ 加载数据文件失败:', err.message);
    }
}

// 保存数据到文件
function saveDataToFile() {
    try {
        serverData.version = new Date().toISOString();
        fs.writeFileSync(DATA_FILE, JSON.stringify(serverData, null, 2));
        console.log('✓ 数据已保存到文件');
    } catch (err) {
        console.error('✗ 保存数据文件失败:', err.message);
    }
}

// 启动时加载数据
loadDataFromFile();

// 验证Token中间件
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: '未提供认证Token' });
    }

    const token = authHeader.split(' ')[1];

    // 在实际生产中，这里应该验证Token的有效性
    // 这里简单检查Token不为空
    if (!token || token.trim() === '') {
        return res.status(401).json({ error: 'Token无效' });
    }

    next();
};

// API 路由

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        serverTime: new Date().toISOString(),
        version: serverData.version
    });
});

// 验证连接和Token
app.get('/api/sync/verify', verifyToken, (req, res) => {
    res.json({
        valid: true,
        serverTime: new Date().toISOString(),
        version: serverData.version
    });
});

// 获取服务器所有数据（下载）
app.get('/api/sync/download', verifyToken, (req, res) => {
    res.json({
        config: serverData.config,
        history: serverData.history || [],
        agents: serverData.agents || [],
        workflows: serverData.workflows || [],
        version: serverData.version,
        serverTime: new Date().toISOString()
    });
});

// 上传所有数据到服务器（上传）
app.post('/api/sync/upload', verifyToken, (req, res) => {
    try {
        const uploadData = req.body;

        // 验证数据格式
        if (!uploadData || typeof uploadData !== 'object') {
            return res.status(400).json({ error: '无效的数据格式' });
        }

        // 更新服务器数据
        serverData = {
            config: uploadData.config || null,
            history: Array.isArray(uploadData.history) ? uploadData.history : [],
            agents: Array.isArray(uploadData.agents) ? uploadData.agents : [],
            workflows: Array.isArray(uploadData.workflows) ? uploadData.workflows : [],
            version: new Date().toISOString()
        };

        // 保存到文件
        saveDataToFile();

        res.json({
            success: true,
            version: serverData.version,
            serverTime: new Date().toISOString()
        });
    } catch (err) {
        console.error('上传数据失败:', err);
        res.status(500).json({ error: '服务器内部错误: ' + err.message });
    }
});

// 错误处理
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({ error: '服务器内部错误' });
});

// 启动服务器
app.listen(PORT, () => {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║  微工作流引擎 - 服务器同步服务                          ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  端口: ${PORT.toString().padEnd(50)}║`);
    console.log(`║  地址: http://localhost:${PORT}${' '.repeat(34)}║`);
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║  API 端点:                                                  ║');
    console.log('║  GET  /api/health          - 健康检查                       ║');
    console.log('║  GET  /api/sync/verify     - 验证连接                       ║');
    console.log('║  GET  /api/sync/download   - 下载数据                       ║');
    console.log('║  POST /api/sync/upload     - 上传数据                       ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║  数据文件:                                                  ║');
    console.log(`║  ${DATA_FILE}${' '.repeat(48 - DATA_FILE.length)}║`);
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('✓ 服务器已启动，等待连接...');
    console.log('');
    console.log('提示: 请确保防火墙允许端口 ' + PORT + ' 的入站连接');
    console.log('');
});

// 优雅关闭
process.on('SIGINT', () => {
    console.log('\n正在关闭服务器...');
    saveDataToFile();
    console.log('✓ 数据已保存');
    console.log('✓ 服务器已关闭');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n正在关闭服务器...');
    saveDataToFile();
    console.log('✓ 数据已保存');
    console.log('✓ 服务器已关闭');
    process.exit(0);
});