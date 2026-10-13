const API = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export async function uploadAnalysis(file, overlayStyle) {
  const form = new FormData();
  form.append("file", file);
  form.append("overlay_style", overlayStyle);

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

export async function getOverlayObjectUrl(id, token) {
  const response = await fetch(`${API}/api/analyses/${id}/overlay`, {
    headers: { "X-Job-Token": token },
  });
  if (!response.ok) throw new Error(await response.text());
  return URL.createObjectURL(await response.blob());
}
