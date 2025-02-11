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
    app.use(express.static('public')); // 添加静态文件支持

    // 公共CSS样式
    const commonStyles = `
        <style>
            :root {
                --primary: #2563eb;
                --secondary: #1e40af;
                --bg: #f8fafc;
                --card-bg: white;
            }
            * { box-sizing: border-box; margin: 0; padding: 0 }
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                line-height: 1.6;
                background: var(--bg);
                color: #1e293b;
            }
            .container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 2rem 1rem;
            }
            .header {
                background: linear-gradient(135deg, var(--primary), var(--secondary));
                color: white;
                padding: 2rem 1rem;
                margin-bottom: 2rem;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            }
            .grid {
                display: grid;
                gap: 1.5rem;
                grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            }
            .card {
                background: var(--card-bg);
                border-radius: 0.5rem;
                padding: 1.5rem;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                transition: transform 0.2s;
            }
            .card:hover {
                transform: translateY(-2px);
            }
            .badge {
                display: inline-block;
                padding: 0.25rem 0.75rem;
                border-radius: 999px;
                background: #e2e8f0;
                font-size: 0.875rem;
            }
            .button {
                display: inline-flex;
                align-items: center;
                gap: 0.5rem;
                padding: 0.5rem 1rem;
                background: var(--primary);
                color: white;
                border-radius: 0.375rem;
                text-decoration: none;
                transition: opacity 0.2s;
            }
            .button:hover {
                opacity: 0.9;
            }
            @media (max-width: 640px) {
                .container {
                    padding: 1rem;
                }
                .header {
                    padding: 1.5rem 1rem;
                }
            }
        </style>
    `;

    // 首页列表
    app.get('/', (req, res) => {
        const repos = getRepositories().map(repo => ({
            name: repo,
            ...repoCache[repo]
        }));

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>TWOSI 开源镜像站</title>
                ${commonStyles}
            </head>
            <body>
                <div class="header">
                    <div class="container">
                        <h1>TWOSI 开源镜像站</h1>
                        <p>天外软件镜像服务 · ${Object.keys(repoCache).length}个仓库镜像中</p>
                    </div>
                </div>
                
                <div class="container">
                    <div class="grid">
                        ${repos.map(repo => `
                            <a href="/${repo.name}/" class="card">
                                <h3>${repo.name.split('/')[1]}</h3>
                                <p style="color: #64748b; margin: 0.5rem 0">
                                    ${repo.name}
                                </p>
                                <div style="margin-top: 1rem">
                                    ${repo.version ? 
                                        `<span class="badge">v${repo.version}</span>` : 
                                        '<span style="color: #ef4444">未同步</span>'}
                                </div>
                            </a>
                        `).join('')}
                    </div>
                </div>
            </body>
            </html>
        `);
    });

    // 仓库详情页
    app.get('/:owner/:repo', (req, res) => {
        const repo = `${req.params.owner}/${req.params.repo}`;
        const data = repoCache[repo];
        
        if (!data) return res.status(404).send('仓库未同步');

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>${repo} - TWOSI</title>
                ${commonStyles}
            </head>
            <body>
                <div class="header">
                    <div class="container">
                        <a href="/" class="button" style="margin-bottom: 1rem">← 返回首页</a>
                        <h1>${repo.split('/')[1]}</h1>
                        <p>${repo} @ v${data.version}</p>
                    </div>
                </div>

                <div class="container">
                    <div class="card">
                        <h2 style="margin-bottom: 1rem">可用版本</h2>
                        <div class="grid">
                            ${data.assets.map(asset => `
                                <div class="card">
                                    <div style="display: flex; justify-content: space-between; align-items: center">
                                        <div>
                                            <h3 style="margin-bottom: 0.25rem">${asset.name}</h3>
                                            <small>${new Date(data.updated_at).toLocaleString()} 同步</small>
                                        </div>
                                        <a href="/${repo}/${asset.name}" 
                                           class="button"
                                           download>
                                            ↓ 下载
                                        </a>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </body>
            </html>
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
    })
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
