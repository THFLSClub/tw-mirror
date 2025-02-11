const fs = require('fs');
const axios = require('axios');
const cron = require('node-cron');
const express = require('express');

const REPOS_FILE = 'repos.txt';
const PORT = 3100;
const MIRROR_BASE = process.env.MIRROR_BASE || 'https://gh.thfls.club/'; // 镜像基础地址
const CACHE_FILE = 'repo_cache.json'; // 版本信息缓存文件

let repoCache = {}; // 内存缓存

// 初始化加载缓存
function loadCache() {
    try {
        repoCache = JSON.parse(fs.readFileSync(CACHE_FILE));
        console.log(`已加载 ${Object.keys(repoCache).length} 个仓库的缓存`);
    } catch (e) {
        console.log('未找到缓存文件，将重新获取数据');
    }
}

// 保存缓存到文件
function saveCache() {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(repoCache, null, 2));
}

// 获取仓库列表
function getRepositories() {
    return fs.readFileSync(REPOS_FILE, 'utf-8')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));
}

// 更新单个仓库信息
async function updateRepo(repo) {
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) return;

    try {
        const { data } = await axios.get(
            `https://api.github.com/repos/${owner}/${repoName}/releases/latest`, 
            {
                headers: {
                    'User-Agent': 'Node.js Mirror Proxy',
                    Authorization: process.env.GITHUB_TOKEN ? `token ${process.env.GITHUB_TOKEN}` : undefined
                }
            }
        );

        repoCache[repo] = {
            version: data.tag_name,
            assets: data.assets.map(a => ({
                name: a.name,
                download_url: a.browser_download_url
            })),
            updated_at: new Date().toISOString()
        };

        saveCache();
        console.log(`[${repo}] 缓存更新成功 (${data.tag_name})`);
    } catch (err) {
        console.error(`[${repo}] 更新失败:`, err.message);
    }
}

// 定时批量更新
function scheduleUpdates() {
    cron.schedule('0 3 * * *', async () => {
        console.log('开始执行定时更新...');
        for (const repo of getRepositories()) {
            await updateRepo(repo);
            await new Promise(resolve => setTimeout(resolve, 1000)); // 防止速率限制
        }
    });
}

// 启动Web服务
function startServer() {
    const app = express();

    // 首页列表
    app.get('/', (req, res) => {
        const repos = getRepositories();
        res.send(`
            <h1>TWOSI - 天外开源软件镜像站</h1>
            <ul>${repos.map(repo => `
                <li>
                    <a href="/${repo}/">${repo}</a>
                    (${repoCache[repo]?.version || '未知版本'})
                </li>`).join('')}
            </ul>
        `);
    });

    // 仓库文件列表
    app.get('/:owner/:repo', (req, res) => {
        const repo = `${req.params.owner}/${req.params.repo}`;
        const data = repoCache[repo];
        
        if (!data) return res.status(404).send('仓库未同步');

        res.send(`
            <h1>${repo} @ ${data.version}</h1>
            <ul>${data.assets.map(asset => `
                <li>
                    <a href="/${repo}/${asset.name}">${asset.name}</a>
                    <a href="${MIRROR_BASE}${asset.download_url}" download>(直接下载)</a>
                </li>`).join('')}
            </ul>
        `);
    });

    // 文件代理下载
    app.get('/:owner/:repo/:filename', (req, res) => {
        const repo = `${req.params.owner}/${req.params.repo}`;
        const filename = req.params.filename;
        const asset = repoCache[repo]?.assets.find(a => a.name === filename);

        if (!asset) return res.status(404).send('文件不存在');
        
        res.redirect(`${MIRROR_BASE}${asset.download_url}`);
    });

    app.listen(PORT, () => {
        console.log(`代理服务运行在 http://localhost:${PORT}`);
    });
}

// 初始化
async function main() {
    loadCache();
    scheduleUpdates();
    startServer();
    
    // 启动时立即更新
    console.log('首次数据同步开始...');
    for (const repo of getRepositories()) {
        await updateRepo(repo);
    }
}

main();
