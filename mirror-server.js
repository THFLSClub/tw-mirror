const fs = require('fs');
const axios = require('axios');
const cron = require('node-cron');
const express = require('express');

const REPOS_FILE = 'repos.txt';
const PORT = process.env.PORT || 3100;
const MIRROR_BASE = process.env.MIRROR_BASE || 'https://gh.thfls.club/';
const CACHE_FILE = 'repo_cache.json';
const SYNC_INTERVAL = process.env.SYNC_INTERVAL || 1500; // 基础间隔时间
const MAX_RETRIES = process.env.MAX_RETRIES || 3;       // 最大重试次数
const RETRY_DELAY = 5 * 60 * 1000; // 5分钟重试延迟

let repoCache = {};

// 初始化加载缓存
function loadCache() {
    try {
        repoCache = JSON.parse(fs.readFileSync(CACHE_FILE));
        console.log(`已加载 ${Object.keys(repoCache).length} 个仓库的缓存`);
    } catch (e) {
        console.log('未找到缓存文件，将重新获取数据');
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

// 更新单个仓库信息
async function updateRepo(repo) {
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) return;

    const cacheEntry = repoCache[repo] || {};
    const syncMeta = cacheEntry._syncMeta || { 
        attempts: 0, 
        nextRetry: null,
        lastSuccess: null,
        priority: 0
    };

    try {
        const headers = {
            'User-Agent': 'Node.js Mirror Proxy',
            Authorization: process.env.GITHUB_TOKEN ? `token ${process.env.GITHUB_TOKEN}` : undefined
        };

        // 获取仓库基础信息
        const { data: repoData } = await axios.get(
            `https://api.github.com/repos/${owner}/${repoName}`,
            { headers }
        );

        // 获取最新发布信息
        const { data: releaseData } = await axios.get(
            `https://api.github.com/repos/${owner}/${repoName}/releases/latest`,
            { headers }
        );

        repoCache[repo] = {
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
            _syncMeta: {
                ...syncMeta,
                attempts: 0,
                nextRetry: null,
                lastSuccess: Date.now()
            }
        };

        saveCache();
        console.log(`[${repo}] 缓存更新成功 (${releaseData.tag_name})`);
        return true;
    } catch (err) {
        console.error(`[${repo}] 更新失败:`, err.message);
        
        syncMeta.attempts += 1;
        syncMeta.nextRetry = Date.now() + 
            (Math.pow(2, syncMeta.attempts) * RETRY_DELAY);
        
        if (syncMeta.attempts >= MAX_RETRIES) {
            console.error(`[${repo}] 达到最大重试次数，暂停同步`);
            syncMeta.nextRetry = Date.now() + (24 * 3600 * 1000);
        }

        repoCache[repo] = { 
            ...cacheEntry, 
            last_error: new Date().toISOString(),
            _syncMeta: syncMeta 
        };
        saveCache();
        return false;
    }
}

// 智能同步队列管理
function getSyncQueue() {
    const now = Date.now();
    return getRepositories()
        .map(repo => {
            const meta = repoCache[repo]?._syncMeta || {};
            return {
                repo,
                priority: calculatePriority(repo, now),
                isRetry: meta.attempts > 0
            };
        })
        .sort((a, b) => b.priority - a.priority);
}

function calculatePriority(repo, now) {
    const meta = repoCache[repo]?._syncMeta || {};
    let priority = 0;
    
    if (meta.lastSuccess) {
        priority += (now - meta.lastSuccess) / 1000;
    } else {
        priority += 24 * 3600;
    }
    
    if (meta.nextRetry && meta.nextRetry < now) {
        priority += 48 * 3600;
    }
    
    return priority;
}

// 智能同步核心逻辑
async function smartSync() {
    const queue = getSyncQueue();
    console.log(`开始同步，队列长度：${queue.length}`);

    for (const { repo, isRetry } of queue) {
        const cacheEntry = repoCache[repo] || {};
        const syncMeta = cacheEntry._syncMeta || { 
            attempts: 0, 
            nextRetry: null,
            lastSuccess: null
        };

        if (syncMeta.nextRetry && Date.now() < syncMeta.nextRetry) continue;

        await updateRepo(repo);
        
        const delay = SYNC_INTERVAL * (isRetry ? 2 : 1);
        await new Promise(resolve => setTimeout(resolve, delay));
    }
}

// 定时任务调度
function scheduleUpdates() {
    cron.schedule('0 * * * *', smartSync); // 每小时整点执行
    cron.schedule('*/5 * * * *', () => {  // 每5分钟重试失败任务
        console.log('执行重试任务...');
        smartSync();
    });
}

// Web服务
function startServer() {
    const app = express();
    app.use(express.static('public'));
    
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
                grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            }
            .card {
                background: var(--card-bg);
                border-radius: 0.5rem;
                padding: 1.5rem;
                text-decoration: none;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                transition: transform 0.2s;
                min-height: 200px;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
            }
            .card h3 {
                font-size: 1.1rem;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .card-description {
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
                color: #64748b;
                margin: 0.5rem 0;
                font-size: 0.9em;
                line-height: 1.4;
            }
            @media (max-width: 640px) {
                .container { padding: 1rem; }
                .header { padding: 1.5rem 1rem; }
                .grid { grid-template-columns: 1fr; }
            }
        </style>
    `;

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
                        let originalCards = Array.from(grid.children);

                        function updateView() {
                            const searchTerm = search.value.toLowerCase();
                            const sortKey = sort.value;
                            
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
                        ${repos.map(repo => {
                            const syncStatus = repo._syncMeta || {};
                            return `
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
                                        <h3>${repo.name.split('/')[1]}</h3>
                                        <p style="color: #64748b; margin: 0.5rem 0">
                                            ${repo.name}
                                        </p>
                                        ${repo.meta?.description ? `
                                            <p class="card-description">${repo.meta.description}</p>
                                        ` : ''}
                                        
                                        <div style="margin-top: auto; padding-top: 1rem;">
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
                                                    margin-top: 0.5rem;
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
                                
                                <div style="margin-top: 0.5rem; color: var(--secondary); font-size: 0.75rem">
                                    ${syncStatus.attempts ? `
                                        <span style="color: #dc2626;">
                                            同步尝试中 (${syncStatus.attempts}/${MAX_RETRIES})
                                        </span>
                                    ` : `
                                        最后同步：${repo.updated_at ? new Date(repo.updated_at).toLocaleDateString() : '从未同步'}
                                    `}
                                </div>
                            </a>
                        `}).join('')}
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
    
    if (!data || !data.version) {
        return res.status(404).redirect('/404');
    }

    // 增加安全访问逻辑
    const versionDisplay = data.version 
        ? (data.version.startsWith('v') ? data.version : `v${data.version}`)
        : '版本信息不可用';

    const assetItems = (data.assets || [])
        .map(asset => `
            <div class="card">
                <div style="display: flex; justify-content: space-between; align-items: center">
                    <div>
                        <h3 style="margin-bottom: 0.25rem">${asset.name || '未命名文件'}</h3>
                        <small>${data.updated_at ? new Date(data.updated_at).toLocaleString() : '未知时间'} 同步</small>
                    </div>
                    ${asset.download_url ? `
                    <a href="/${repo}/${asset.name}" 
                       style="padding: 0.5rem 1rem; background: var(--primary); color: white; border-radius: 0.375rem; text-decoration: none;"
                       download>
                        ↓
                    </a>
                    ` : '<span style="color: var(--error)">无效链接</span>'}
                </div>
            </div>
        `).join('');

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
                    <p>${repo} @ ${versionDisplay}</p>
                </div>
            </div>

            <div class="container">
                <div class="card">
                    <h2 style="margin-bottom: 1rem">可用下载</h2>
                    <div class="grid">
                        ${assetItems}
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
