import json

d = json.load(open("/tmp/opps.json"))
ms = d.get("markets") or []

def pct(x):
    return f"{round(x*100)}%" if isinstance(x, (int, float)) else str(x)

def cents(x):
    return f"{round(x*100)}c" if isinstance(x, (int, float)) else str(x)

for i, m in enumerate(ms[:5], 1):
    a = m.get("analysis") or {}
    ev = m.get("eventTitle") or m.get("groupItemTitle") or ""
    created = (a.get("createdAt") or "")[:16].replace("T", " ")
    print()
    print(f"{i}. [{a.get('betSide')}  edge {a.get('edgeScore')}  div {a.get('divergenceScore')}/10]  {m.get('question')}")
    if ev:
        print(f"   event: {ev}")
    print(f"   YES {cents(m.get('yesPrice'))} | rule-implied P(YES) {pct(a.get('ruleImpliedProbability'))} | {a.get('divergenceType')} | stage={m.get('verifyStage')} | {a.get('pass')} @ {created} IST")
    vibe = (a.get("vibeInterpretation") or "").strip().replace("\n", " ")
    lit = (a.get("literalInterpretation") or "").strip().replace("\n", " ")
    print(f"   vibe   : {vibe[:220]}")
    print(f"   literal: {lit[:220]}")
