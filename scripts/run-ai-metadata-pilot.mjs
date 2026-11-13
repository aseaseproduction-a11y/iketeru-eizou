import { readFileSync, writeFileSync } from "node:fs";

const root = "/home/ubuntu/iketeru-eizou/analysis/ai_metadata_completion";
const inputPath = process.env.AI_ANALYSIS_INPUT || `${root}/inputs_0_3_enriched.json`;
const outputPath = process.env.AI_ANALYSIS_OUTPUT || `${root}/pilot_output_v2.jsonl`;
const inputs = JSON.parse(readFileSync(inputPath, "utf8"));
const schema = JSON.parse(readFileSync(`${root}/schema_v2.json`, "utf8"));
const system = readFileSync(`${root}/system_prompt_v2.txt`, "utf8");

async function analyze(input, index) {
  try {
    const response = await fetch(`${process.env.BUILT_IN_FORGE_API_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.BUILT_IN_FORGE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5-mini",
        max_completion_tokens: 1600,
        messages: [{ role: "system", content: system }, { role: "user", content: `入力データ: ${JSON.stringify(input)}` }],
        response_format: { type: "json_schema", json_schema: { name: "safe_video_metadata", strict: true, schema } },
      }),
    });
    const raw = await response.text();
    if (!response.ok) return { index, input: JSON.stringify(input), output: null, error: `HTTP ${response.status}: ${raw.slice(0, 300)}` };
    const completion = JSON.parse(raw);
    const output = completion?.choices?.[0]?.message?.content;
    if (typeof output !== "string" || !output) return { index, input: JSON.stringify(input), output: null, error: "empty_model_content" };
    JSON.parse(output);
    return { index, input: JSON.stringify(input), output, error: null, usage: completion.usage ?? null };
  } catch (error) {
    return { index, input: JSON.stringify(input), output: null, error: String(error) };
  }
}

const results = [];
for (let index = 0; index < inputs.length; index += 1) {
  results.push(await analyze(inputs[index], index));
  console.log(`completed ${index + 1}/${inputs.length}`);
}
writeFileSync(outputPath, `${results.map((result) => JSON.stringify(result)).join("\n")}\n`);
console.log(JSON.stringify({ outputPath, total: results.length, errors: results.filter((result) => result.error).length }));
