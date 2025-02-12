const fs = require('fs');
const axios = require('axios');
const cron = require('node-cron');
const express = require('express');

const REPOS_FILE = 'repos.txt';
const PORT = 3100;
const MIRROR_BASE = process.env.MIRROR_BASE || 'https://gh.thfls.club/';
const CACHE_FILE = 'repo_cache.json';

let repoCache = {};

// 在updateRepo函数中添加仓库详细信息获取
async function updateRepo(repo) {
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) return;

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
            {
                headers: {
                    'User-Agent': 'Node.js Mirror Proxy',
                    Authorization: process.env.GITHUB_TOKEN ? `token ${process.env.GITHUB_TOKEN}` : undefined
                }
            }
        );

        repoCache[repo] = {
            version: releaseData.tag_name,
            assets: releaseData.assets.map(a => ({
                name: a.name,
                download_url: a.browser_download_url
            })),
            updated_at: new Date().toISOString(),
            // 新增仓库元数据
            meta: {
                stars: repoData.stargazers_count,
                description: repoData.description,
                language: repoData.language,
                last_commit: repoData.pushed_at
            }
        };

        saveCache();
        console.log(`[${repo}] 缓存更新成功 (${releaseData.tag_name})`);
    } catch (err) {
        console.error(`[${repo}] 更新失败:`, err.message);
        // 保留旧数据，仅更新错误时间
        if (repoCache[repo]) {
            repoCache[repo].last_error = new Date().toISOString();
        }
    }
}

// 页面样式优化
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
        /* 新增加载动画 */
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
        /* 骨架屏动画 */
        @keyframes shimmer {
            100% { transform: translateX(100%); }
        }
        .skeleton {
            position: relative;
            overflow: hidden;
            background: #f1f5f9;
        }
        .skeleton::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 50%;
            height: 100%;
            background: linear-gradient(90deg, 
                rgba(255,255,255,0) 0%,
                rgba(255,255,255,0.3) 50%,
                rgba(255,255,255,0) 100%);
            animation: shimmer 1.5s infinite;
        }
    </style>
`;

// 增强的首页模板
function renderHome(repos) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>TWOSI 开源镜像站</title>
            ${commonStyles}
            <!-- 新增前端交互脚本 -->
            <script>
                document.addEventListener('DOMContentLoaded', () => {
                    const search = document.getElementById('search');
                    const sort = document.getElementById('sort');
                    const grid = document.querySelector('.grid');
                    
                    function updateView() {
                        const searchTerm = search.value.toLowerCase();
                        const sortKey = sort.value;
                        
                        Array.from(grid.children)
                            .filter(card => {
                                const title = card.dataset.name.toLowerCase();
                                const desc = card.dataset.desc?.toLowerCase() || '';
                                return title.includes(searchTerm) || desc.includes(searchTerm);
                            })
                            .sort((a, b) => {
                                if (sortKey === 'stars') {
                                    return b.dataset.stars - a.dataset.stars;
                                }
                                return new Date(b.dataset.updated) - new Date(a.dataset.updated);
                            })
                            .forEach(card => grid.appendChild(card));
                    }
                    
                    search.addEventListener('input', updateView);
                    sort.addEventListener('change', updateView);
                });
            </script>
        </head>
        <body>
            <div class="header">
                <div class="container">
                    <h1>TW-Mirror 开源镜像站</h1>
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
                            <option value="name">名称排序</option>
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
                            data-updated="${repo.updated_at}"
                        >
                            <div style="display: flex; gap: 1rem; align-items: start;">
                                <div style="flex: 1">
                                    <h3 style="color: var(--primary)">
                                        ${repo.name.split('/')[1]}
                                    </h3>
                                    ${repo.meta?.description ? `
                                        <p style="
                                            color: var(--secondary);
                                            margin: 0.5rem 0;
                                            font-size: 0.9em;
                                            line-height: 1.4;
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
                                                <svg style="width: 14px; height:14px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                                                </svg>
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
                                                <svg style="width:14px;height:14px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                                                </svg>
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
                                                <svg style="width:14px;height:14px" fill="currentColor" viewBox="0 0 20 20">
                                                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                                                </svg>
                                                ${repo.meta.stars.toLocaleString()}
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
                                最后同步：${new Date(repo.updated_at).toLocaleDateString()}
                                ${repo.last_error ? `
                                    <span style="color: var(--error); margin-left: 0.5rem">
                                        (上次失败: ${new Date(repo.last_error).toLocaleTimeString()})
                                    </span>
                                ` : ''}
                            </div>
                        </a>
                    `).join('')}
                </div>
            </div>
        </body>
        </html>
    `;
}

// 调整首页路由
app.get('/', (req, res) => {
    const repos = getRepositories().map(repo => ({
        name: repo,
        ...repoCache[repo]
    }));
    
    res.send(renderHome(repos));
});

// 其他路由保持不变...
