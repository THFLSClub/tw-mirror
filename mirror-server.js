const fs = require('fs');
const axios = require('axios');
const cron = require('node-cron');
const express = require('express');

const REPOS_FILE = 'repos.txt';
const PORT = process.env.PORT || 3100;
const MIRROR_BASE = process.env.MIRROR_BASE || 'https://gh.thfls.club/';
const CACHE_FILE = 'repo_cache.json';
const REQUEST_INTERVAL = 3000; // 基础请求间隔 3 秒
const MAX_RETRY_ATTEMPTS = 5;  // 最大重试次数

let repoCache = {};

// 初始化加载缓存
function loadCache() {
    try {
        repoCache = JSON.parse(fs.readFileSync(CACHE_FILE));
        console.log(`已加载 ${Object.keys(repoCache).length} 个仓库的缓存`);
    } catch (e) {
        repoCache = {};
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

// 计算下次重试时间（指数退避）
function calcNextRetry(failCount) {
    const baseDelay = 5 * 60 * 1000; // 5 分钟基础等待
    return Date.now() + (baseDelay * Math.pow(2, failCount));
}

// 更新单个仓库信息
async function updateRepo(repo) {
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) return;

    const currentRepo = repoCache[repo] || {
        retryCount: 0,
        nextRetry: 0
    };

    // 检查是否在冷却期
    if (currentRepo.nextRetry > Date.now()) {
        console.log(`[${repo}] 跳过（冷却中，剩余 ${Math.ceil((currentRepo.nextRetry - Date.now())/60000)} 分钟）`);
        return;
    }

    try {
        // 获取仓库基础信息
        const { data: repoData } = await axios.get(
            `https://api.github.com/repos/${owner}/${repoName}`,
            {
                headers: {
                    'User-Agent': 'Node.js Mirror Proxy',
                    Authorization: process.env.GITHUB_TOKEN ? `token ${process.env.GITHUB_TOKEN}` : undefined
                }
            }
        );

        // 获取最新发布信息
        const { data: releaseData } = await axios.get(
            `https://api.github.com/repos/${owner}/${repoName}/releases/latest`,
            { headers: { 'User-Agent': 'Node.js Mirror Proxy' } }
        );

        repoCache[repo] = {
            ...repoCache[repo],
            version: releaseData.tag_name,
            assets: releaseData.assets.map(a => ({
                name: a.name,
                download_url: a.browser_download_url
            })),
            updated_at: new Date().toISOString(),
            meta: {
                stars: repoData.stargazers_count,
                description: repoData.description,
                language: repoData.language,
                last_commit: repoData.pushed_at
            },
            retryCount: 0, // 重置重试计数
            nextRetry: 0    // 重置重试时间
        };

        saveCache();
        console.log(`[${repo}] 缓存更新成功 (${releaseData.tag_name})`);
    } catch (err) {
        console.error(`[${repo}] 更新失败:`, err.message);
        
        const newRetryCount = currentRepo.retryCount + 1;
        repoCache[repo] = {
            ...currentRepo,
            retryCount: newRetryCount,
            nextRetry: calcNextRetry(newRetryCount),
            last_error: new Date().toISOString()
        };
        
        if (newRetryCount >= MAX_RETRY_ATTEMPTS) {
            console.error(`[${repo}] 已达到最大重试次数，停止重试`);
        }
        saveCache();
    }
}

// 智能排序仓库更新顺序
function getSortedRepos() {
    return getRepositories()
        .map(repo => ({
            name: repo,
            lastUpdated: repoCache[repo]?.updated_at || 0,
            retryCount: repoCache[repo]?.retryCount || 0
        }))
        .sort((a, b) => {
            // 优先处理需要重试的仓库
            if (a.retryCount > 0 || b.retryCount > 0) {
                return a.retryCount - b.retryCount;
            }
            // 没有重试的按更新时间排序
            return new Date(b.lastUpdated) - new Date(a.lastUpdated);
        });
}

// 定时批量更新
function scheduleUpdates() {
    cron.schedule('0 3 * * *', async () => {
        console.log('开始执行定时更新...');
        const repos = getSortedRepos();
        
        for (const repo of repos) {
            await updateRepo(repo.name);
            await new Promise(resolve => setTimeout(resolve, REQUEST_INTERVAL));
        }
    });
}

// 启动Web服务
function startServer() {
    const app = express();
    app.use(express.static('public'));
    
    // 公共样式和脚本
    const commonStyles = `
        <style>
            :root {
                --primary: #6366f1;
                --primary-hover: #4f46e5;
                --secondary: #64748b;
                --bg: #f8fafc;
                --card-bg: white;
                --success: #22c55e;
                --error: #ef4444;
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
                grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
       
            }
            .card {
                background: var(--card-bg);
                border-radius: 0.5rem;
                padding: 1.5rem;
                text-decoration: none;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                transition: transform 0.2s;
                word-break: break-word;
                overflow-wrap: anywhere;
            }
            /* 限制内容宽度 */
        .repo-name {
            max-width: 90%;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        /* 弹性布局防止溢出 */
        .card > div:first-child {
            display: flex;
            gap: 1rem;
            justify-content: space-between;
        }
        /* 语言标签对齐方式 */
        .language-tag {
            flex-shrink: 0;
            align-self: flex-start;
        }
            .card:hover {
                transform: translateY(-2px);
            }
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
            .loader {
                width: 24px;
                height: 24px;
                border: 3px solid #e2e8f0;
                border-top-color: var(--primary);
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }
            @media (max-width: 640px) {
                .container { padding: 1rem; }
                .header { padding: 1.5rem 1rem; }
            }
        </style>
    `;

    // 首页路由
    app.get('/', (req, res) => {
        const repos = getRepositories().map(repo => ({
            name: repo,
            ...(repoCache[repo] || {})
        }));

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>TWOSI 开源镜像站</title>
                ${commonStyles}
<script>
    document.addEventListener('DOMContentLoaded', () => {
        const search = document.getElementById('search');
        const sort = document.getElementById('sort');
        const grid = document.querySelector('.grid');
        let originalCards = Array.from(grid.children); // 保存原始卡片副本

        function updateView() {
            const searchTerm = search.value.toLowerCase();
            const sortKey = sort.value;
            
            // 始终使用原始副本进行过滤
            const filtered = originalCards.filter(card => {
                const title = card.dataset.name.toLowerCase();
                const desc = card.dataset.desc?.toLowerCase() || '';
                return title.includes(searchTerm) || desc.includes(searchTerm);
            });
            
            const sorted = filtered.sort((a, b) => {
                if (sortKey === 'stars') {
                    return (b.dataset.stars || 0) - (a.dataset.stars || 0);
                }
                return new Date(b.dataset.updated) - new Date(a.dataset.updated);
            });
            
            // 清空并重新添加元素
            grid.innerHTML = '';
            sorted.forEach(card => grid.appendChild(card.cloneNode(true)));
        }

        search.addEventListener('input', updateView);
        sort.addEventListener('change', updateView);
    });
</script>
            </head>
            <body>
                <div class="header">
                    <div class="container">
                        <h1>TWOSI 开源镜像站</h1>
                        <p>天外软件镜像服务 · ${Object.keys(repoCache).length}个仓库镜像中</p>
                        <div style="margin-top: 1.5rem; display: flex; gap: 1rem; flex-wrap: wrap;">
                            <input 
                                type="text" 
                                id="search" 
                                placeholder="搜索仓库..." 
                                style="
                                    padding: 0.75rem;
                                    border: 1px solid #e2e8f0;
                                    border-radius: 0.5rem;
                                    flex: 1;
                                    min-width: 300px;
                                ">
                            <select
                                id="sort"
                                style="
                                    padding: 0.75rem;
                                    border: 1px solid #e2e8f0;
                                    border-radius: 0.5rem;
                                    background: white;
                                ">
                                <option value="updated">最近更新</option>
                                <option value="stars">最多收藏</option>
                            </select>
                        </div>
                    </div>
                </div>
                
                <div class="container">
                    <div class="grid">
                        ${repos.map(repo => `
                            <a 
                                href="/${repo.name}/" 
                                class="card"
                                data-name="${repo.name}"
                                data-desc="${repo.meta?.description || ''}"
                                data-stars="${repo.meta?.stars || 0}"
                                data-updated="${repo.updated_at || ''}"
                            >
                                <div style="display: flex; gap: 1rem; align-items: start;">
                                    <div style="flex: 1">
                                        <h3 style="color: var(--primary)">
                                            ${repo.name.split('/')[1]}
                                        </h3>
                                        <p style="color: #64748b; margin: 0.5rem 0">
                                            ${repo.name}
                                        </p>
                                        ${repo.meta?.description ? `
                                            <p style="
                                                color: var(--secondary);
                                                margin: 0.5rem 0;
                                                font-size: 0.9em;
                                            ">${repo.meta.description}</p>
                                        ` : ''}
                                        
                                        <div style="margin-top: 1rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                            ${repo.version ? `
                                                <div style="
                                                    display: inline-flex;
                                                    align-items: center;
                                                    gap: 0.25rem;
                                                    padding: 0.25rem 0.75rem;
                                                    background: #e0f2fe;
                                                    border-radius: 0.375rem;
                                                    color: #0369a1;
                                                    font-size: 0.875rem;
                                                ">
                                                    ${repo.version.startsWith('v') ? repo.version : 'v' + repo.version}
                                                </div>
                                            ` : `
                                                <div style="
                                                    display: inline-flex;
                                                    align-items: center;
                                                    gap: 0.25rem;
                                                    padding: 0.25rem 0.75rem;
                                                    background: #fee2e2;
                                                    color: #dc2626;
                                                    border-radius: 0.375rem;
                                                    font-size: 0.875rem;
                                                ">
                                                    同步失败
                                                </div>
                                            `}
                                            
                                            ${repo.meta?.stars ? `
                                                <div style="
                                                    display: inline-flex;
                                                    align-items: center;
                                                    gap: 0.25rem;
                                                    padding: 0.25rem 0.75rem;
                                                    background: #f1f5f9;
                                                    border-radius: 0.375rem;
                                                    font-size: 0.875rem;
                                                ">
                                                    ★ ${repo.meta.stars.toLocaleString()}
                                                </div>
                                            ` : ''}
                                        </div>
                                    </div>
                                    
                                    ${repo.meta?.language ? `
                                        <div style="
                                            padding: 0.25rem 0.75rem;
                                            background: #f1f5f9;
                                            border-radius: 0.375rem;
                                            font-size: 0.875rem;
                                        ">${repo.meta.language}</div>
                                    ` : ''}
                                </div>
                                
                                <div style="margin-top: 1rem; color: var(--secondary); font-size: 0.875rem">
                                    最后同步：${repo.updated_at ? new Date(repo.updated_at).toLocaleDateString() : '从未同步'}
                                </div>
                            </a>
                        `).join('')}
                    </div>
                </div>
            </body>
            </html>
        `;
        res.send(html);
    });

    // 仓库详情页
    app.get('/:owner/:repo', (req, res) => {
        const repo = `${req.params.owner}/${req.params.repo}`;
        const data = repoCache[repo];
        
if (!data) {
        return res.status(404).redirect('/404'); // 重定向到404页面
}
        
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
                        <a href="/" style="color: white; text-decoration: none; display: inline-block; margin-bottom: 1rem">
                            ← 返回首页
                        </a>
                        <h1>${repo.split('/')[1]}</h1>
                        <p>${repo} @ ${data.version.startsWith('v') ? data.version : 'v' + data.version}</p>
                    </div>
                </div>

                <div class="container">
                    <div class="card">
                        <h2 style="margin-bottom: 1rem">可用下载</h2>
                        <div class="grid">
                            ${data.assets.map(asset => `
                                <div class="card">
                                    <div style="display: flex; justify-content: space-between; align-items: center">
                                        <div>
                                            <h3 style="margin-bottom: 0.25rem">${asset.name}</h3>
                                            <small>${new Date(data.updated_at).toLocaleString()} 同步</small>
                                        </div>
                                        <a href="/${repo}/${asset.name}" 
                                           style="
                                                padding: 0.5rem 1rem;
                                                background: var(--primary);
                                                color: white;
                                                border-radius: 0.375rem;
                                                text-decoration: none;
                                           "
                                           download>
                                            ↓
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

        if (!asset) {
        return res.status(404).redirect('/404'); // 重定向到404页面
    }

        
        res.redirect(`${MIRROR_BASE}${asset.download_url}`);
    });

    app.all('*', (req, res) => {
    res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>页面未找到 - TWOSI</title>
            ${commonStyles}
        </head>
        <body>
            <div class="header">
                <div class="container">
                    <h1>404 - 页面未找到</h1>
                    <p>请求的资源不存在</p>
                </div>
            </div>
            <div class="container">
                <div class="card" style="text-align: center; padding: 3rem">
                    <p style="font-size: 1.2rem; margin-bottom: 1.5rem">😢 您访问的页面不存在</p>
                    <a href="/" style="
                        padding: 0.75rem 1.5rem;
                        background: var(--primary);
                        color: white;
                        border-radius: 0.5rem;
                        text-decoration: none;
                        display: inline-block;
                    ">返回首页</a>
                </div>
            </div>
        </body>
        </html>
    `);
});

    app.listen(PORT, () => {
        console.log(`服务已启动: http://localhost:${PORT}`);
    });
}

// 初始化
async function main() {
    loadCache();
    scheduleUpdates();
    startServer();
    
    // 启动时智能更新
    console.log('执行首次数据同步...');
    const repos = getSortedRepos();
    for (const repo of repos) {
        await updateRepo(repo.name);
        await new Promise(resolve => setTimeout(resolve, REQUEST_INTERVAL));
    }
}

main();
