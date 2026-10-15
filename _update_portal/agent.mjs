// Production planning runs through the owner's local ChatGPT-authenticated Codex.
// This module intentionally has no fetch call or API-key inference path.
export async function plan(){throw Error('Paid API planning is disabled; use the local ChatGPT worker');}
