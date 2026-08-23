import { SOURCE_IMAGE_BUCKET, isSupabaseConfigured, supabase } from "./supabaseClient.js";

function requireClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to frontend/.env"
    );
  }
  return supabase;
}

function safeFileName(name) {
  return name.replace(/[^\w.\-]+/g, "_");
}

/**
 * Uploads the image bytes to Storage, then stores metadata in the images table.
 * Do not put raw image blobs in Postgres — Storage is the file store.
 */
export async function uploadSourceImage(file, id) {
  const client = requireClient();
  const storagePath = `${id}/${safeFileName(file.name)}`;

  const { error: uploadError } = await client.storage
    .from(SOURCE_IMAGE_BUCKET)
    .upload(storagePath, file, {
      cacheControl: "3600",
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data, error: insertError } = await client
    .from("images")
    .insert({
      id,
      name: file.name,
      relative_path: file.webkitRelativePath || file.name,
      size_bytes: file.size,
      content_type: file.type || null,
      storage_path: storagePath,
    })
    .select()
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return data;
}

/** Loads previously stored image metadata (not the file bytes). */
export async function listSourceImages() {
  const client = requireClient();
  const { data, error } = await client
    .from("images")
    .select("id, name, relative_path, size_bytes, storage_path, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}
