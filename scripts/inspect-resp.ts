import "dotenv/config";
import OpenAI from "openai";

async function main() {
  const respId = "resp_0d768f6f8384838e006a1346ae9d6c819190745f5b449cf5a7";
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env: any = await client.responses.retrieve(respId);
  console.log("status:", env.status);
  console.log("model:", env.model);

  // Reproduce the extractText logic
  let text = "";
  if (typeof env.output_text === "string" && env.output_text.length > 0) text = env.output_text;
  else if (Array.isArray(env.output)) {
    const parts: string[] = [];
    for (const item of env.output) {
      if (typeof item.text === "string") parts.push(item.text);
      if (Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c && c.type === "output_text" && typeof c.text === "string") parts.push(c.text);
          else if (c && c.type === "text" && typeof c.text === "string") parts.push(c.text);
        }
      }
    }
    text = parts.join("\n");
  }

  console.log("\n---- full text length:", text.length);
  // Find the JSON portion
  const parts2 = text.split(/---\s*JSON\s*---/i);
  const jsonText = parts2.length >= 2 ? parts2.slice(1).join("\n").trim() : text.slice(text.lastIndexOf("{"));
  console.log("\n---- JSON portion (first 2000 chars):");
  console.log(jsonText.slice(0, 2000));
  console.log("\n---- chars around pos 676 of JSON:");
  console.log(JSON.stringify(jsonText.slice(660, 720)));
}
main().catch((e) => { console.error(e); process.exit(1); });
