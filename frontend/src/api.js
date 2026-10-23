const API = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export async function uploadAnalysis(file, overlayStyle, flipped) {
  const form = new FormData();
  form.append("file", file);
  form.append("overlay_style", overlayStyle);
  if (flipped !== null) form.append("flipped", String(flipped));

  const response = await fetch(`${API}/api/analyses`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json(); // { id, token, status }
}

export async function getAnalysis(id, token) {
  const response = await fetch(`${API}/api/analyses/${id}`, {
    headers: { "X-Job-Token": token },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function getOverlayObjectUrl(id, token, style) {
  const params = new URLSearchParams({ overlay_style: style });
  const response = await fetch(`${API}/api/analyses/${id}/overlay?${params}`, {
    headers: { "X-Job-Token": token },
  });
  if (!response.ok) throw new Error(await response.text());
  return URL.createObjectURL(await response.blob());
}
