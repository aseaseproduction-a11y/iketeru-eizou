import { readFileSync, writeFileSync } from "node:fs";

const root = "/home/ubuntu/iketeru-eizou/analysis/ai_metadata_completion";
const input = JSON.parse(readFileSync(`${root}/inputs_0_3.json`, "utf8"))[0];
const schema = JSON.parse(readFileSync(`${root}/schema_v2.json`, "utf8"));
const system = readFileSync(`${root}/system_prompt_v2.txt`, "utf8");
const response = await fetch(`${process.env.BUILT_IN_FORGE_API_URL}/v1/chat/completions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.BUILT_IN_FORGE_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "gpt-5-mini",
    max_completion_tokens: 1600,
    messages: [{ role: "system", content: system }, { role: "user", content: `入力データ: ${JSON.stringify(input)}` }],
    response_format: { type: "json_schema", json_schema: { name: "safe_video_metadata", strict: true, schema } },
  }),
});
const body = await response.text();
writeFileSync(`${root}/llm_probe_v2_response.json`, `${body}\n`);
console.log(JSON.stringify({ status: response.status, bytes: body.length }));
