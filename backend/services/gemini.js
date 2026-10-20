// services/gemini.js — كل استدعاءات Gemini (توليد مع أدوات، تفريغ صوت، قراءة إيصال، ملخص، صوت)
const { GoogleGenAI } = require('@google/genai');
const { spawn } = require('child_process');
const config = require('../config');

let client = null;
function ai() {
  if (!config.gemini.apiKey) throw new Error('GEMINI_API_KEY غير موجود في .env');
  if (!client) client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return client;
}

function baseConfig(extra = {}) {
  const cfg = { temperature: 0.4, ...extra };
  if (config.gemini.thinkingLevel) cfg.thinkingConfig = { thinkingLevel: config.gemini.thinkingLevel };
  return cfg;
}

/** أدوات بدون معاملات: نحذف parameters الفارغة (بعض النماذج ترفض OBJECT بلا خصائص) */
function cleanTools(tools) {
  return tools.map((t) => {
    const p = t.parameters;
    if (p && p.type === 'OBJECT' && (!p.properties || !Object.keys(p.properties).length)) {
      const { parameters, ...rest } = t;
      return rest;
    }
    return t;
  });
}

function errStatus(e) {
  return e?.status ?? e?.code ?? e?.error?.code ?? (/"code":\s*(\d{3})/.exec(e?.message || '') || [])[1];
}

/**
 * استدعاء مع إعادة المحاولة:
 * 1) النموذج الأساسي  2) نفس النموذج بعد تأخير  3) بدون thinking ثم النموذج الاحتياطي GEMINI_FALLBACK_MODEL
 * أخطاء 500/503/429 من Google مؤقتة غالباً — تُعاد تلقائياً ولا تصل للعميل إلا إذا فشلت كل المحاولات
 */
async function generate({ systemInstruction, contents, tools, temperature, responseSchema }) {
  const cfg = baseConfig({ systemInstruction });
  if (temperature !== undefined) cfg.temperature = temperature;
  if (tools?.length) cfg.tools = [{ functionDeclarations: cleanTools(tools) }];
  if (responseSchema) {
    cfg.responseMimeType = 'application/json';
    cfg.responseSchema = responseSchema;
  }
  const plan = [
    { model: config.gemini.model, cfg },
    { model: config.gemini.model, cfg, delay: 1200 },
    { model: config.gemini.model, cfg: { ...cfg, thinkingConfig: undefined }, delay: 2000 },
  ];
  if (config.gemini.fallbackModel && config.gemini.fallbackModel !== config.gemini.model) {
    plan.push({ model: config.gemini.fallbackModel, cfg: { ...cfg, thinkingConfig: undefined }, delay: 500 });
  }
  let lastErr;
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    if (step.delay) await new Promise((r) => setTimeout(r, step.delay));
    try {
      const res = await ai().models.generateContent({ model: step.model, contents, config: step.cfg });
      if (i > 0) console.log(`✅ Gemini نجح في المحاولة ${i + 1}${step.model !== config.gemini.model ? ` (النموذج الاحتياطي ${step.model})` : ''}`);
      return res;
    } catch (e) {
      lastErr = e;
      const st = Number(errStatus(e));
      const shortMsg = String(e.message || '').slice(0, 160);
      console.warn(`⚠️ Gemini محاولة ${i + 1}/${plan.length} فشلت (${st || '?'}): ${shortMsg}`);
      // أخطاء الطلب نفسه (400/401/403/404) لن تُحل بالإعادة على نفس النموذج — ننتقل مباشرة للبديل إن وُجد
      if ([400, 401, 403].includes(st)) {
        if (st === 401 || st === 403) break; // مفتاح خاطئ — لا فائدة
        if (i < 2) i = 1; // تخطي الإعادة المطابقة والانتقال لمحاولة بدون thinking
      }
    }
  }
  throw lastErr;
}

function responseText(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('\n').trim();
}

function functionCalls(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => p.functionCall).map((p) => p.functionCall);
}

/** Gemini يفهم الصوت مباشرة — نطلب تفريغاً حرفياً فقط */
async function transcribeAudio(buffer, mimeType) {
  const res = await generate({
    temperature: 0,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: buffer.toString('base64') } },
          { text: 'فرّغ هذه الرسالة الصوتية حرفياً بلغتها ولهجتها كما هي، بدون أي إضافة أو شرح. إن كانت فارغة اكتب: [صوت غير واضح]' },
        ],
      },
    ],
  });
  return responseText(res) || '[صوت غير واضح]';
}

/** تحليل صورة: هل هي إيصال دفع؟ وإن كانت كذلك استخرج المبلغ والتاريخ والاسم */
async function analyzeImage(buffer, mimeType, caption = '') {
  const res = await generate({
    temperature: 0,
    responseSchema: {
      type: 'OBJECT',
      properties: {
        is_receipt: { type: 'BOOLEAN', description: 'هل الصورة إيصال تحويل/دفع؟' },
        amount: { type: 'NUMBER', nullable: true },
        currency: { type: 'STRING', nullable: true },
        date: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD إن أمكن' },
        payer_name: { type: 'STRING', nullable: true },
        beneficiary_name: { type: 'STRING', nullable: true },
        reference: { type: 'STRING', nullable: true },
        method: { type: 'STRING', nullable: true, description: 'CliQ / bank transfer / card ...' },
        description: { type: 'STRING', description: 'وصف قصير جداً لمحتوى الصورة بالعربية (مثلاً: صورة تسريب ماء تحت المغسلة)' },
      },
      required: ['is_receipt', 'description'],
    },
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: buffer.toString('base64') } },
          { text: `حلل الصورة. تعليق المرسل: "${caption || '-'}". أعد JSON فقط.` },
        ],
      },
    ],
  });
  try {
    return JSON.parse(responseText(res));
  } catch {
    return { is_receipt: false, description: 'صورة' };
  }
}

/** تحديث ملخص المحادثة */
async function summarize(previousSummary, transcriptLines) {
  const res = await generate({
    temperature: 0.2,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `حدّث ملخص محادثة واتساب لفندق في 5 أسطر كحد أقصى: من هو العميل، ماذا يريد، التواريخ/العدد/السعر المتفق، الطلبات المفتوحة، أي ملاحظة مهمة (مزاجه، تفضيلاته).
الملخص السابق:
${previousSummary || '-'}

الرسائل الجديدة:
${transcriptLines}

اكتب الملخص الجديد فقط.`,
          },
        ],
      },
    ],
  });
  return responseText(res);
}

/** تحويل نص إلى رسالة صوتية OGG/Opus (اختياري — يتطلب ffmpeg على السيرفر) */
async function textToSpeechOgg(text) {
  const res = await ai().models.generateContent({
    model: config.gemini.ttsModel,
    contents: [{ role: 'user', parts: [{ text }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.gemini.ttsVoice } } },
    },
  });
  const part = res?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error('لم يُرجع نموذج الصوت أي بيانات');
  const pcm = Buffer.from(part.inlineData.data, 'base64');
  const rate = Number((part.inlineData.mimeType || '').match(/rate=(\d+)/)?.[1] || 24000);
  return pcmToOgg(pcm, rate);
}

function pcmToOgg(pcm, rate) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-loglevel', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', 'pipe:1']);
    const chunks = [];
    ff.stdout.on('data', (c) => chunks.push(c));
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('ffmpeg فشل'))));
    ff.stdin.end(pcm);
  });
}

module.exports = { generate, responseText, functionCalls, transcribeAudio, analyzeImage, summarize, textToSpeechOgg };
