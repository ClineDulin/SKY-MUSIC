// LightAndSky 乐谱库 — 飞书数据同步脚本
// 流程：读 Bitable → 拉每个乐谱知识库页面 PV → 写回 Bitable「浏览次数」字段 → 生成 scores.json
// 运行方式（本地）：node scripts/sync.js （需配置 .env 中的飞书凭证）
// 运行方式（CI）：GitHub Actions 注入 secrets 为环境变量后执行

const fs = require('fs');
const path = require('path');

// ===== 简易 .env 加载（不引入 dotenv 依赖）=====
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  });
}

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const APP_TOKEN = process.env.FEISHU_BITABLE_APP_TOKEN; // Bitable app_token
const TABLE_ID = process.env.FEISHU_BITABLE_TABLE_ID;

const BASE = 'https://open.feishu.cn/open-apis';
const SLEEP_MS = 300; // 文件统计接口节流
const OUTPUT = path.join(process.cwd(), 'scores.json');

// ===== 字段名映射（与 Bitable 列名一致，调整列名时同步改这里）=====
const FIELDS = {
  title: '曲名',
  composer: '作者/来源',
  category: '琴谱类型',
  intro: '注意事项',
  remark: '备注/类型',
  feishuUrl: '知识库页面',
  createdAt: '投稿时间',
  views: '浏览次数',
  status: '状态',
};

// 状态 → 分类映射；不在映射中的状态（S3、异常/特殊）不展示
const STATUS_CATEGORY = {
  'S1': '导入谱',
  'S2': '图谱',
};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 从 Bitable 字段值中提取纯文本（处理数组、对象等格式）
function fieldText(val) {
  if (!val) return '';
  if (Array.isArray(val)) return val.map((it) => (typeof it === 'object' ? it.text || it.name || '' : String(it))).join('');
  if (typeof val === 'object') return val.text || val.name || '';
  return String(val);
}

async function getTenantToken() {
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const data = await res.json();
  if (!data.tenant_access_token) {
    throw new Error('获取 tenant_access_token 失败：' + JSON.stringify(data));
  }
  return data.tenant_access_token;
}

async function listBitableRecords(token) {
  const records = [];
  let pageToken = '';
  do {
    const url = `${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records?page_size=100${pageToken ? '&page_token=' + pageToken : ''}`;
    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
    });
    const data = await res.json();
    if (data.code !== 0) {
      throw new Error('读取 Bitable 失败：' + JSON.stringify(data));
    }
    (data.data.items || []).forEach((it) => records.push(it));
    pageToken = data.data.has_more ? data.data.page_token : '';
  } while (pageToken);
  return records;
}

async function updateRecord(token, recordId, fields) {
  const url = `${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/${recordId}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ fields }),
  });
  const data = await res.json();
  if (data.code !== 0) {
    console.warn('  ⚠ 写回失败：' + JSON.stringify(data));
  }
  return data;
}

// 通过 wiki 节点 token 获取实际的文件 token 和类型
async function getWikiNodeInfo(token, wikiToken) {
  const url = `${BASE}/wiki/v2/spaces/get_node?token=${wikiToken}`;
  const res = await fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
  });
  const data = await res.json();
  if (data.code !== 0) {
    console.warn('   获取 wiki 节点信息失败：' + JSON.stringify(data));
    return null;
  }
  const node = data.data?.node || {};
  return { objToken: node.obj_token, objType: node.obj_type || 'docx' };
}

async function getDocStatistics(token, wikiToken) {
  // 先解析 wiki 节点，拿到实际文件 token 和类型
  const nodeInfo = await getWikiNodeInfo(token, wikiToken);
  if (!nodeInfo || !nodeInfo.objToken) {
    console.warn('   无法获取文件 token，跳过统计');
    return null;
  }
  const url = `${BASE}/drive/v1/files/${nodeInfo.objToken}/statistics?file_type=${nodeInfo.objType}`;
  const res = await fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
  });
  const data = await res.json();
  if (data.code !== 0) {
    console.warn('   拉取统计失败：' + JSON.stringify(data));
    return null;
  }
  const stat = data.data || {};
  return {
    pv: stat.pv != null ? Number(stat.pv) : (stat.view_count != null ? Number(stat.view_count) : 0),
    uv: stat.uv != null ? Number(stat.uv) : 0,
    like: stat.like_count != null ? Number(stat.like_count) : 0,
  };
}

// 从「知识库页面」字段（Markdown 链接 [label](url)）中提取 URL 与 wiki token
function parseWikiLink(raw) {
  if (!raw) return { url: '', token: '' };
  let s;
  if (Array.isArray(raw)) {
    // 飞书 Bitable 字段返回数组，优先取 link（超链接 URL），其次 text（Markdown 或纯文本）
    s = raw.map((it) => (typeof it === 'object' ? it.link || it.text || '' : String(it))).join('');
  } else if (typeof raw === 'object') {
    s = raw.link || raw.text || '';
  } else {
    s = String(raw);
  }
  const m = s.match(/\]\((https?:\/\/[^)\s]+)/);
  const url = m ? m[1] : (s.startsWith('http') ? s : '');
  const tm = url.match(/\/wiki\/([A-Za-z0-9]+)/);
  return { url, token: tm ? tm[1] : '' };
}

async function main() {
  if (!APP_ID || !APP_SECRET || !APP_TOKEN || !TABLE_ID) {
    throw new Error('请配置 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_BITABLE_APP_TOKEN / FEISHU_BITABLE_TABLE_ID');
  }

  console.log('▶ 获取 tenant_access_token...');
  const token = await getTenantToken();

  console.log('▶ 读取 Bitable 记录...');
  const records = await listBitableRecords(token);
  console.log(`  共 ${records.length} 条记录`);

  // 调试：打印第一条记录的字段结构，帮助排查格式问题
  if (records[0]) {
    const f = records[0].fields || {};
    console.log('  [调试] 第一条记录字段：');
    for (const [key, val] of Object.entries(f)) {
      const display = typeof val === 'string' ? val : JSON.stringify(val);
      console.log(`    ${key}: ${display.slice(0, 200)}`);
    }
  }

  console.log('▶ 拉取知识库页面 PV 并写回 Bitable「浏览次数」...');
  for (const rec of records) {
    const f = rec.fields || {};
    const { token: wikiToken } = parseWikiLink(f[FIELDS.feishuUrl]);
    if (!wikiToken) {
      console.log(`  - 跳过（无知识库页面）：${fieldText(f[FIELDS.title])}`);
      continue;
    }
    console.log(`  - 处理：${fieldText(f[FIELDS.title])} → ${wikiToken}`);
    const stat = await getDocStatistics(token, wikiToken);
    await sleep(SLEEP_MS);
    if (stat) {
      console.log(`    PV=${stat.pv} UV=${stat.uv}`);
      await updateRecord(token, rec.record_id, { [FIELDS.views]: stat.pv });
    } else {
      console.log(`    统计获取失败，跳过写回`);
    }
  }

  console.log('▶ 重新读取 Bitable（含写回的浏览次数）...');
  const fresh = await listBitableRecords(token);

  console.log('▶ 生成 scores.json...');
  const scores = fresh
    .map((rec) => {
      const f = rec.fields || {};
      const { url } = parseWikiLink(f[FIELDS.feishuUrl]);
      if (!url) return null; // 跳过未发布（无知识库页面）的记录
      const status = fieldText(f[FIELDS.status]);
      const category = STATUS_CATEGORY[status];
      if (!category) return null; // S3、异常/特殊 等不展示
      const intro = [fieldText(f[FIELDS.intro]), fieldText(f[FIELDS.remark])].filter(Boolean).join(' / ');
      const dateVal = f[FIELDS.createdAt];
      let dateStr = '';
      if (dateVal) {
        const ms = typeof dateVal === 'number' ? dateVal : Date.parse(fieldText(dateVal));
        dateStr = isNaN(ms) ? String(dateVal) : new Date(ms).toISOString().slice(0, 10);
      }
      return {
        id: rec.record_id,
        title: fieldText(f[FIELDS.title]),
        composer: fieldText(f[FIELDS.composer]),
        category,
        intro,
        feishu_url: url,
        created_at: dateStr,
        views: Number(f[FIELDS.views] || 0),
        status,
      };
    })
    .filter(Boolean);

  fs.writeFileSync(OUTPUT, JSON.stringify(scores, null, 2), 'utf8');
  console.log(`✓ 已写入 ${OUTPUT}（${scores.length} 条）`);
}

main().catch((err) => {
  console.error('✗ 同步失败：', err.message);
  process.exit(1);
});
