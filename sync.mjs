// 简单的定时同步脚本：用真实浏览器打开源页面（让客户端 JS / 跳转正常执行），
// 取回数据后转发到接收端。如接收端返回需要补充明细的 id，再逐个取明细页回传。
// 所有地址通过环境变量传入，便于复用。
//
// 环境变量：
//   SOURCE_URL  数据来源页面
//   SINK_URL    接收端地址
//   SINK_TOKEN  接收端校验令牌

import { chromium } from "playwright";

const SOURCE_URL = process.env.SOURCE_URL;
const SINK_URL = process.env.SINK_URL;
const SINK_TOKEN = process.env.SINK_TOKEN;

if (!SOURCE_URL || !SINK_URL || !SINK_TOKEN) {
  console.error("missing env: SOURCE_URL / SINK_URL / SINK_TOKEN");
  process.exit(1);
}

const SINK_HEADERS = { "Content-Type": "application/json", "X-Ingest-Secret": SINK_TOKEN };

// 在页面上下文里取数据（与站点自身相同的请求方式）。
const FETCH_DATA =
  "fetch('/',{method:'POST',credentials:'include'," +
  "headers:{'X-Requested-With':'XMLHttpRequest'," +
  "'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},body:''})" +
  ".then(r=>r.json()).catch(()=>null)";

// 取某条记录的明细页，抽取其中的地址行（h5），在页面上下文执行。
async function detailAddress(page, id) {
  return page.evaluate(async (x) => {
    const r = await fetch("/balloon/" + x, {
      method: "POST",
      credentials: "include",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: "",
    });
    const j = await r.json().catch(() => null);
    if (!j || !j.content) return null;
    const el = new DOMParser().parseFromString(j.content, "text/html").querySelector("h5");
    return el ? el.textContent.replace(/\s+/g, " ").trim() : null;
  }, id);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ locale: "ru-RU" });
    const page = await ctx.newPage();
    await page.goto(SOURCE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

    // 源页面在客户端加载完成后才返回数据，轮询等待。
    let data = null;
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(5000);
      const j = await page.evaluate(FETCH_DATA).catch(() => null);
      if (j && Array.isArray(j.features) && j.features.length > 0) {
        data = j;
        break;
      }
    }
    if (!data) throw new Error("no data");
    console.log(`items: ${data.features.length}`);

    // 诊断：会话凭据能否被普通请求复用（便于以后简化流程）。
    let sessionReusable = null;
    try {
      const cookies = await ctx.cookies();
      const ua = await page.evaluate(() => navigator.userAgent);
      const cookieHeader = cookies.map((x) => `${x.name}=${x.value}`).join("; ");
      const r = await fetch(SOURCE_URL, {
        method: "POST",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Cookie: cookieHeader,
          "User-Agent": ua,
        },
        body: "",
      });
      sessionReusable = (await r.text()).includes('"features"');
    } catch {
      sessionReusable = false;
    }

    // 1) 提交主数据；接收端可能返回需要补充明细的 id 列表（needAddr）。
    const r1 = await fetch(SINK_URL, {
      method: "POST",
      headers: SINK_HEADERS,
      body: JSON.stringify({ at: Date.now(), cookieReusable: sessionReusable, data }),
    });
    console.log(`sink: ${r1.status}`);
    if (!r1.ok) throw new Error(`sink ${r1.status}`);
    const res1 = await r1.json().catch(() => ({}));
    const need = Array.isArray(res1.needAddr) ? res1.needAddr : [];
    console.log(`need detail: ${need.length}`);

    // 2) 逐个取明细页抽取地址行，回传给接收端缓存。
    if (need.length) {
      const addresses = {};
      for (const id of need) {
        try {
          const a = await detailAddress(page, id);
          if (a) addresses[id] = a;
        } catch {
          /* пропускаем единичные сбои */
        }
      }
      const r2 = await fetch(SINK_URL, {
        method: "POST",
        headers: SINK_HEADERS,
        body: JSON.stringify({ addresses }),
      });
      console.log(`sink addr: ${r2.status} (${Object.keys(addresses).length})`);
    }
    console.log("done");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(2);
});
