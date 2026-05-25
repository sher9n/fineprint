export function modelShortName(model: string): string {
  if (!model) return "?";
  if (model.includes("haiku")) return "haiku";
  if (model.includes("sonnet")) return "sonnet";
  if (model.includes("opus")) return "opus";
  return model.replace(/^claude-/, "").split("-")[0];
}

export function passLabel(model: string, pass: string): string {
  const short = modelShortName(model);
  return pass === "opus" ? `${short}+web` : short;
}
