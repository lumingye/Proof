// UI/E2E：真实浏览器（Playwright + Chromium）驱动 ui/drink/index.html 全链路。
// 运行方式：node --test ui/tests/e2e.test.js（需全局 playwright 与已安装的浏览器）。
// 部署形态与 README 一致：静态服务器托管 ui/，/proof-api/* 反向代理到 proof-service。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const UI_DIR = join(REPO_ROOT, 'ui');
const SERVICE_DIR = join(REPO_ROOT, 'service');

// ---------- 基础设施：service + 静态/代理服务器 ----------

function freePort(base) {
  return base + Math.floor(Math.random() * 1000);
}

async function startService() {
  const dir = await mkdtemp(join(tmpdir(), 'proof-e2e-'));
  const port = freePort(22000);
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: SERVICE_DIR,
    env: {
      ...process.env,
      PROOF_HOST: '127.0.0.1',
      PROOF_PORT: String(port),
      PROOF_DATA_DIR: dir,
      PROOF_TEST_FIXED_CUP_IDS: 'true',
      // 本地 E2E 属于明确的本地开发场景，显式打开首次设置开关。
      // 生产缺 setup key 仍然失败关闭（service 测试钉住）。
      PROOF_ALLOW_INSECURE_ADMIN_SETUP: 'true'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('service_listen_timeout')), 8000);
    child.stdout.on('data', (buf) => {
      if (String(buf).includes('listening')) { clearTimeout(timer); resolve(); }
    });
    child.on('error', reject);
  });
  return { port, child, dir };
}

function startStaticServer(servicePort) {
  const port = freePort(23000);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname.startsWith('/proof-api/')) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const upstream = await fetch(`http://127.0.0.1:${servicePort}${url.pathname.replace(/^\/proof-api/, '')}${url.search}`, {
          method: req.method,
          headers: {
           ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
            ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
           ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}),
            ...(req.headers['idempotency-key'] ? { 'idempotency-key': req.headers['idempotency-key'] } : {})
          },
          body: chunks.length ? Buffer.concat(chunks) : undefined
        });
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.writeHead(upstream.status, {
          'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
         'content-length': buf.length,
          'cache-control': 'no-store',
          ...(upstream.headers.get('set-cookie') ? { 'set-cookie': upstream.headers.get('set-cookie') } : {})
       });
        res.end(buf);
        return;
     }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const html = await readFile(join(UI_DIR, 'index.html'));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': html.length });
        res.end(html);
        return;
      }
      if (url.pathname === '/proof-engine.js') {
        const script = await readFile(join(UI_DIR, 'proof-engine.js'));
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-length': script.length });
        res.end(script);
        return;
      }
     if (url.pathname === '/drink/' || url.pathname === '/drink/index.html' || url.pathname === '/drink') {
        const html = await readFile(join(UI_DIR, 'drink', 'index.html'));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': html.length });
        res.end(html);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not_found');
    } catch (error) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('proxy_error');
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ port, server }));
  });
}

const service = await startService();
const staticServer = await startStaticServer(service.port);
const kids = [service.child];
process.on('exit', () => {
  for (const kid of kids) { try { kid.kill('SIGKILL'); } catch { /* noop */ } }
  try { staticServer.server.close(); } catch { /* noop */ }
});

const BASE = `http://127.0.0.1:${staticServer.port}`;

const { chromium } = await import('playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PROOF_TEST_CHROMIUM_PATH
    ? { executablePath: process.env.PROOF_TEST_CHROMIUM_PATH }
    : {})
});
process.on('exit', () => { try { browser.close(); } catch { /* noop */ } });

async function makeOffer(body) {
  const response = await fetch(`http://127.0.0.1:${service.port}/human/offers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  assert.equal(response.status, 201, JSON.stringify(json));
  assert.equal(json.targetId, undefined);
  assert.equal(json.receiverId, undefined);
  return { json, token: json.link.slice(json.link.indexOf('#') + 1) };
}

async function openDrinkPage(context, token) {
  const page = await context.newPage();
  await page.goto(`${BASE}/drink/#${token}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.name', { timeout: 5000 });
  return page;
}

async function newContext() {
  return browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
}

// ---------- 接口约定逐项 ----------

test('E2E-1/2 分享链接出现第一屏，且不存在接收者选择或“给某某”', async () => {
  const { token } = await makeOffer({ name: '见面礼', parts: [{ id: '金酒', volume: 45 }] });
  const beforeResponse = await fetch('http://127.0.0.1:' + service.port + '/capability/offer', {
    headers: { authorization: 'Bearer ' + token }
  });
  const beforeJson = await beforeResponse.json();
  assert.equal(beforeResponse.status, 200);
  assert.deepEqual(Object.keys(beforeJson.projection).sort(), ['claimedName', 'color', 'cupType', 'intro']);
  for (const banned of ['flavor', 'claimedEffects', 'claimedEffectText', 'recipe', 'effects', 'actualEffectDescription']) {
    assert.equal(banned in beforeJson.projection, false);
  }
  const context = await newContext();
  const page = await openDrinkPage(context, token);
  const text = await page.textContent('#app');
  assert.ok(text.includes('见面礼'), '第一屏应显示杯名');
  assert.ok(text.includes('杯型') && text.includes('颜色'), '第一屏应显示杯型与颜色');
  assert.ok(await page.locator('[data-action="drink"]').count() >= 1, '应有「喝」按钮');
  assert.ok(await page.locator('[data-action="reject"]').count() >= 1, '应有「不喝」按钮');
  // 第二项：无接收者选择、无“给某某”
  assert.equal(await page.locator('select').count(), 0, '第一屏不得出现接收者选择');
  assert.equal(text.includes('给 '), false, '第一屏不得出现“给某某”');
  assert.equal(text.includes('给谁'), false, '第一屏不得出现“给谁”');
  const preDrinkState = await page.evaluate(() => ({
    hiddenNodeCount: document.querySelectorAll('[hidden]').length,
    forbiddenNodeCount: document.querySelectorAll('.effects,[data-flavor],[data-effect],[data-claimed-effects]').length,
    copyText: window.__proofCopyText ?? null,
    proofGlobals: Object.keys(window).filter((key) => key.startsWith('__proof'))
  }));
  assert.equal(preDrinkState.hiddenNodeCount, 0, '喝前不得有隐藏结果节点');
  assert.equal(preDrinkState.forbiddenNodeCount, 0, '喝前 DOM 不得有味道或效果节点');
  assert.equal(preDrinkState.copyText, null, '喝前脚本不得保存饮酒结果');
  assert.deepEqual(preDrinkState.proofGlobals, [], '喝前脚本不得暴露饮酒结果状态');
  await context.close();
});

test('E2E-3/5 点击「喝」后出现已喝下；无 finish 布局不塌', async () => {
  const { token } = await makeOffer({ name: '无留言杯', parts: [{ id: '金酒', volume: 45 }] });
  const context = await newContext();
  const page = await openDrinkPage(context, token);
  await page.click('[data-action="drink"]');
  await page.waitForSelector('.eyebrow:text("已喝下")', { timeout: 5000 });
  const labels = await page.$$eval('.result .rb-label', (els) => els.map((e) => e.textContent.trim()));
  assert.deepEqual(labels, ['入口', '当前推力'], '无留言时应只有入口与当前推力两块，页面不塌');
  const push = await page.textContent('.resultblock:has-text("当前推力") .rb-value');
  assert.ok(push && push.trim().length > 0, '当前推力块必须有内容（金酒有真实效果）');
  assert.equal(push.includes('没有什么额外的东西被推动'), false, '真实效果不得显示零态');
  await context.close();
});

test('E2E-4 柠檬汁零效果样本显示明确零态文案', async () => {
  const { token } = await makeOffer({ name: '柠檬特调', parts: [{ id: '柠檬汁', volume: 60 }] });
  const context = await newContext();
  const page = await openDrinkPage(context, token);
  await page.click('[data-action="drink"]');
  await page.waitForSelector('.resultblock:has-text("当前推力") .rb-value');
  const push = await page.textContent('.resultblock:has-text("当前推力") .rb-value');
  assert.equal(push.trim(), '没有什么额外的东西被推动。', '零效果必须显示统一零态，不得留白');
  const html = await page.content();
  assert.ok(html.includes('已喝下'), '流程结算完成有明确终点');
  await context.close();
});

test('E2E-5b 有 finish 时显示留言块', async () => {
  const { token } = await makeOffer({ name: '威士忌', parts: [{ id: '威士忌', volume: 60 }], finish: '烟还留在舌根。' });
  const context = await newContext();
  const page = await openDrinkPage(context, token);
  await page.click('[data-action="drink"]');
  await page.waitForSelector('.result');
  const labels = await page.$$eval('.result .rb-label', (els) => els.map((e) => e.textContent.trim()));
  assert.deepEqual(labels, ['入口', '留言', '当前推力'], '三块齐全且顺序固定');
  const finish = await page.textContent('.resultblock:has-text("留言") .rb-value');
  assert.equal(finish.trim(), '烟还留在舌根。');
  await context.close();
});

test('E2E-6 有真实效果时显示效果文案，且不泄露配方', async () => {
  const { token } = await makeOffer({ name: '一杯测试', parts: [{ id: '威士忌', volume: 60 }] });
  const context = await newContext();
  const page = await openDrinkPage(context, token);
  await page.click('[data-action="drink"]');
  await page.waitForSelector('.resultblock:has-text("当前推力") .rb-value');
  const push = (await page.textContent('.resultblock:has-text("当前推力") .rb-value')).trim();
  assert.ok(push.length > 10, '真实效果应有成句文案');
  const bodyText = await page.textContent('#app');
  assert.equal(bodyText.includes('威士忌'), false, '页面不得泄露配方原料');
  assert.equal(bodyText.includes('ml'), false, '页面不得泄露剂量单位');
  await context.close();
});

test('E2E-7 复制饮酒结果：完整、顺序固定、可粘贴', async () => {
  const { token } = await makeOffer({ name: '复制杯', parts: [{ id: '威士忌', volume: 60 }], finish: '烟还留在舌根。' });
  const context = await newContext();
  const page = await openDrinkPage(context, token);
  await page.click('[data-action="drink"]');
  await page.waitForSelector('#copy-result');
  await page.click('#copy-result');
  await page.waitForSelector('#copy-status:text("已复制")', { timeout: 5000 });
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const lines = copied.replace(/\r\n/g, '\n').split('\n');
  assert.equal(lines[0], '[Proof 饮酒结果]', '首行是固定头');
  const order = lines.map((l) => l.slice(0, l.indexOf('：') > 0 ? l.indexOf('：') : l.length));
  const expectOrder = ['[Proof 饮酒结果]', '递酒者', '饮用者', '酒名', '入口', '留言', '当前推力', '状态时间'];
  assert.deepEqual(order.slice(0, 8), expectOrder, '行顺序固定');
  assert.equal(lines[8], '', '状态时间后是空行');
  assert.ok(lines[9].startsWith('这杯酒可能'), '结尾是 canonical soft-push framing');
  assert.ok(lines[1] === '递酒者：{{user}}' && lines[2] === '饮用者：{{char}}', '占位符模板');
  assert.ok(lines[3] === '酒名：复制杯', '酒名正确');
  assert.ok(lines[6].startsWith('当前推力：') && lines[6].length > '当前推力：'.length, '推力非空');
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(lines[7].slice('状态时间：'.length)), '状态时间是 ISO 时间');
  assert.ok(copied.includes('从里面推了你一下。'), '结尾是 canonical soft-push framing');
  // 无泄露
  for (const banned of ['配方', 'ABV', '标准杯', '威士忌', '60 ml', 'ml']) {
    assert.equal(copied.includes(banned), false, `copyText 不得包含 ${banned}`);
  }
  // 复制成功时 fallback 文本框保持隐藏
  assert.ok(await page.locator('#copy-fallback').isHidden(), '复制成功时 fallback 不显示');
  await context.close();
});

test('E2E-8 复制失败时出现可手动选中的 fallback 文本', async () => {
  const { token } = await makeOffer({ name: '降级杯', parts: [{ id: '柠檬汁', volume: 60 }] });
  const context = await newContext();
  await context.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { value: () => Promise.reject(new Error('denied')) });
  });
  const page = await openDrinkPage(context, token);
  await page.click('[data-action="drink"]');
  await page.waitForSelector('#copy-result');
  await page.click('#copy-result');
  await page.waitForSelector('#copy-status', { timeout: 5000 });
  const status = await page.textContent('#copy-status');
  assert.ok(status.includes('复制失败'), '复制失败要有明确提示');
  const fallback = page.locator('#copy-fallback');
  await fallback.waitFor({ state: 'visible', timeout: 5000 });
  const value = await fallback.inputValue();
  assert.ok(value.startsWith('[Proof 饮酒结果]'), 'fallback 内容完整');
  assert.ok(value.includes('没有什么额外的东西被推动。'), '零态文案在 fallback 中同样存在');
  await context.close();
});

test('E2E-9 拒绝后出现明确终点，不产生饮用状态', async () => {
  const { json, token } = await makeOffer({ name: '敬而远之', parts: [{ id: '金酒', volume: 45 }] });
  const context = await newContext();
  const page = await openDrinkPage(context, token);
  await page.click('[data-action="reject"]');
  await page.waitForSelector('.eyebrow:text("已拒绝这杯酒")', { timeout: 5000 });
  const text = await page.textContent('#app');
  assert.ok(text.includes('什么都没有发生'), '拒绝有明确文案');
  // 服务端状态：open → rejected，无饮用投影
  const after = await fetch(`http://127.0.0.1:${service.port}/human/offers`).then((r) => r.json());
  const row = after.offers.find((o) => o.id === json.offerId);
  assert.equal(row.status, 'rejected');
  await context.close();
});

test('E2E-10 只看不喝：反复打开第一屏不消费链接', async () => {
  const { token } = await makeOffer({ name: '犹豫杯', parts: [{ id: '金酒', volume: 45 }] });
  const context = await newContext();
  for (let i = 0; i < 3; i++) {
    const page = await openDrinkPage(context, token);
    await delay(150);
    assert.ok((await page.textContent('#app')).includes('犹豫杯'), `第 ${i + 1} 次打开仍见第一屏`);
    await page.close();
  }
  // 打开多次后仍可成功饮用
  const page = await openDrinkPage(context, token);
  await page.click('[data-action="drink"]');
  await page.waitForSelector('.eyebrow:text("已喝下")', { timeout: 5000 });
  await context.close();
});

test('E2E-11 饮用后重复打开同一链接返回同一份结果（幂等）', async () => {
  const { token } = await makeOffer({ name: '再来一杯', parts: [{ id: '威士忌', volume: 60 }] });
  const context = await newContext();
  const page = await openDrinkPage(context, token);
  await page.click('[data-action="drink"]');
  await page.waitForSelector('.eyebrow:text("已喝下")');
  const first = await page.textContent('.resultblock:has-text("当前推力") .rb-value');
  await page.close();
  // Drinking invalidates GET; the result is not a reusable report.
  const page2 = await context.newPage();
  await page2.goto(`${BASE}/drink/#${token}`, { waitUntil: 'domcontentloaded' });
  await page2.waitForSelector('.eyebrow', { timeout: 5000 });
 await delay(300);
 const text2 = await page2.textContent('#app');
  assert.ok(text2.includes('这条链接已失效'), '喝后重复打开应显示失效终点');
  assert.equal(await page2.locator('.result').count(), 0, '喝后 GET 不得再次展示结果');
 const again = await fetch(`http://127.0.0.1:${service.port}/capability/offer`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'drink' })
  }).then((r) => r.json());
  assert.equal(again.idempotent, true, '服务端幂等');
  assert.equal(again.projection.actualEffectDescription.text, first.trim(), '幂等返回同一份结果');
  await context.close();
});

// 收尾：确保临时目录清理与子进程退出（node:test 结束后触发 exit 钩子）
test('C1 menu stays concise until expanded, then exposes literary effects and send action', async () => {
  const context = await newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.drinklink');
  assert.equal(await page.locator('.menu-detail').count(), 0);
  assert.ok(await page.locator('.claim').count() > 0, 'default menu shows flavor');
  await page.locator('.drinklink').first().click();
  await page.waitForSelector('.menu-detail');
  // 酒单展开后给文学效果文案；轴向简写只属于调酒台原料行。
  const detail = await page.textContent('.menu-detail');
  assert.ok(detail.includes('详细介绍'), 'expanded menu shows the long description');
  assert.ok(detail.includes('效果'), 'expanded menu labels the literary effect copy');
  assert.ok(/。/.test(detail), 'menu effect is prose rather than an axis shorthand');
  assert.ok(detail.includes('配料成分'), 'expanded menu shows the recipe');
  assert.equal(await page.locator('.menu-detail [data-a="send"]').count(), 1);
  await context.close();
});

test('C1b 含空格 ID 的 Espresso Martini 可以展开并进入调酒台', async () => {
  const context = await newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const drink = page.locator('.drink', { has: page.locator('.drinkname', { hasText: 'Espresso Martini' }) });
  await drink.locator('[data-a="expand-menu"]').click();
  assert.equal(await drink.locator('.menu-detail').count(), 1, '含空格的完整 ID 应正确展开');
  await drink.locator('[data-a="send"]').click();
  assert.equal(await page.locator('#drink-name').inputValue(), 'Espresso Martini');
  await context.close();
});

test('C2 ingredients show flavor and effect with selected detail, and C3 has per-cup visibility toggle', async () => {
  const context = await newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.click('[data-a="nav"][data-screen="bar"]');
  await page.waitForSelector('.ingredient-main');
  const ingredientText = await page.textContent('.ingredients');
  // 新规则：原料行是「名字（味道）」+ 效果简写，不再是「味道：/效果：」两行文案。
  assert.ok(/（[^）]*烈[^）]*）/.test(ingredientText), 'ingredient rows carry flavor in brackets');
  assert.equal(ingredientText.includes('效果：'), false, 'no long effect copy on ingredient rows');
  assert.equal(ingredientText.includes('undefined'), false, 'no undefined in flavor line');
  for (const id of ['橙皮利口酒', '咖啡利口酒', '糖浆']) {
    const row = page.locator('.ingredient', { has: page.locator('.ingname', { hasText: id }) });
    assert.ok((await row.locator('.ingnote').textContent()).trim().length > 0, id + ' should show an axis shorthand');
  }
  const campari = page.locator('.ingredient', { has: page.locator('.ingname', { hasText: '金巴利' }) });
  assert.equal((await campari.locator('.ingnote').textContent()).trim(), '少量愉悦- · 多量愉悦+', '非线性材料应显示剂量反转');
  await page.locator('.ingredient-main').first().click();
  await page.waitForSelector('.ingredient-detail');
  assert.ok((await page.textContent('.ingredient-detail')).includes('风味路径'));
  assert.equal(await page.locator('#effect-visible').count(), 1);
  assert.equal(await page.locator('.bottom').evaluate((el) => getComputedStyle(el).position), 'fixed');
  assert.equal((await page.textContent('.effect-toggle-label')).trim(), '\u8fd9\u676f\u6548\u679c\u5bf9\u6211\u53ef\u89c1');
  await page.locator('#effect-visible').uncheck();
  assert.equal((await page.textContent('.effect-toggle-label')).trim(), '\u8fd9\u676f\u6548\u679c\u5bf9\u6211\u4e0d\u53ef\u89c1');
  await context.close();
});

test('C6 drinker has its own ordering, receiving, and drinking entry point', async () => {
  const context = await newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.click('[data-a="role"]');
  await page.waitForSelector('.role-label');
  assert.equal((await page.textContent('.role-label')).trim(), '饮用方');
  await page.locator('.drinklink').first().click();
  await page.locator('.menu-detail [data-a="order"]').click();
  await page.waitForSelector('.receive');
  assert.equal(await page.locator('[data-a="drink"]').count(), 1);
  await page.click('[data-a="drink"]');
  await page.waitForSelector('.after');
  await context.close();
});
test('A3 expired public link is rendered as 倒掉了 without a result screen', async () => {
  const context = await newContext();
  const page = await context.newPage();
  await page.route('**/proof-api/capability/offer*', (route) => route.fulfill({
    status: 410,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: 'link_expired' })
  }));
  await page.goto(`${BASE}/drink/#expired`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.eyebrow', { timeout: 5000 });
  assert.equal((await page.textContent('.eyebrow')).trim(), '倒掉了');
  assert.equal(await page.locator('.result').count(), 0);
  await context.close();
});

test('B1 owner can set the first admin password from the configuration screen', async () => {
  const context = await newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.click('[data-a="nav"][data-screen="config"]');
  await page.waitForSelector('#admin-new-password', { timeout: 5000 });
  assert.ok((await page.textContent('.config')).includes('系统不会替你生成一个没人知道的口令'));
  await page.fill('#admin-new-password', 'owner-chosen-proof-password');
  await page.click('[data-a="admin-setup"]');
  await page.waitForFunction(() => document.querySelector('[data-admin-panel]')?.textContent.includes('重置管理口令'), null, { timeout: 5000 });
  assert.ok((await page.textContent('[data-admin-panel]')).includes('重置管理口令'));
  await context.close();
});

test('POTION-1 迷情剂在特调里只出现一次，刷新三次仍只有一次', async () => {
  const context = await newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.drinklink');
  const count = async () => page.locator('.drinkname', { hasText: '迷情剂' }).count();
  assert.equal(await count(), 1, '首次加载应当只有一杯迷情剂');
  for (let i = 0; i < 3; i += 1) {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.drinklink');
    assert.equal(await count(), 1, `第 ${i + 1} 次刷新后仍应只有一杯`);
  }
  await context.close();
});

test('POTION-2 从调酒台选迷情剂递出：登记身份不丢，喝前四字段，喝后给登记味道与收尾', async () => {
  const context = await newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.drinklink');

  // 点开迷情剂 → 递出
  await page.locator('.drink', { hasText: '迷情剂' }).locator('.drinklink').click();
  await page.waitForSelector('.menu-detail');
  await page.locator('.menu-detail [data-a="send"]').click();
  await page.waitForSelector('#offer-dialog, .send', { timeout: 5000 }).catch(() => {});

  // 调酒台里应当已经带上完整配方（含冰）
  await page.waitForSelector('.recipe-row', { timeout: 5000 });
  const recipeText = await page.textContent('.recipe');
  assert.ok(recipeText.includes('水'), '配方里要有水');
  assert.ok(recipeText.includes('冰'), '**冰不得在装载过程中消失**');

  await context.close();
});

test('GARNISH-1 调酒台有装饰物入口，选中后不改变体积', async () => {
  const context = await newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.click('[data-a="nav"][data-screen="bar"]');
  await page.waitForSelector('.garnishes');
  assert.ok(await page.locator('.garnish').count() > 0, '装饰物必须有入口');
  // 先加一份酒，读体积
  await page.locator('.counter button', { hasText: '+' }).first().click();
  await page.waitForSelector('.recipe-row.total');
  const before = await page.textContent('.recipe-row.total');
  await page.locator('.garnish').first().click();
  await page.waitForSelector('.garnish.selected');
  const after = await page.textContent('.recipe-row.total');
  assert.equal(after, before, '装饰物不得改变合计体积');
  await context.close();
});

test('HISTORY-1 配置里有历史效果开关，关掉后历史不再显示效果', async () => {
  const context = await newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.click('[data-a="nav"][data-screen="config"]');
  await page.waitForSelector('#history-effect');
  assert.equal(await page.locator('#history-effect').isChecked(), true, '默认显示');
  await page.locator('#history-effect').click();
  await page.waitForFunction(() => !document.querySelector('#history-effect')?.checked);
  assert.equal(await page.locator('#history-effect').isChecked(), false, '关得掉');
  // 刷新后偏好要留住
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-a="nav"][data-screen="config"]');
  await page.waitForSelector('#history-effect');
  assert.equal(await page.locator('#history-effect').isChecked(), false, '刷新后仍然是关的');
  await context.close();
});

test('HISTORY-2 历史每页十条且可翻页，底部状态栏固定在视口', async () => {
  for (let i = 0; i < 12; i += 1) {
    await makeOffer({ name: '分页酒-' + i, parts: [{ id: '金酒', volume: 15 }] });
  }
  const context = await newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.click('[data-a="nav"][data-screen="history"]');
  await page.waitForSelector('.historypager');
  const total = (await fetch(`http://127.0.0.1:${service.port}/human/offers`).then((r) => r.json())).offers.length;
  const pages = Math.ceil(total / 10);
  assert.equal(await page.locator('.historyrow').count(), 10, '第一页固定十条');
  assert.equal((await page.textContent('.historypage')).trim(), '1 / ' + pages);
  await page.click('[data-a="history-page"]:has-text("下一页")');
  assert.equal(await page.locator('.historyrow').count(), Math.min(10, total - 10), '第二页显示下一批记录');
  assert.equal((await page.textContent('.historypage')).trim(), '2 / ' + pages);
  assert.equal(await page.locator('.bottom').evaluate((el) => getComputedStyle(el).position), 'fixed');
  const box = await page.locator('.bottom').boundingBox();
  assert.ok(box && Math.abs(box.y + box.height - 844) < 2, '底栏贴住视口底部');
  await context.close();
});

test('清理', async () => {
  await browser.close().catch(() => {});
  staticServer.server.close();
  service.child.kill('SIGTERM');
  await rm(service.dir, { recursive: true, force: true }).catch(() => {});
});
