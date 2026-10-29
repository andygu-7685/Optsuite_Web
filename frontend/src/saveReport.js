const BUCKET = 'characterization-images'

export async function saveCharacterizationReport({ client, userId, file, overlayUrl, result, overlayStyle, flipped }) {
  const reportId = crypto.randomUUID()
  const extension = file.name.match(/\.[a-z0-9]+$/i)?.[0].toLowerCase() || '.bin'
  const prefix = `${userId}/${reportId}`
  const originalPath = `${prefix}/original${extension}`
  const overlayPath = `${prefix}/overlay.png`
  const bucket = client.storage.from(BUCKET)
  const uploadedPaths = []

  try {
    const overlayResponse = await fetch(overlayUrl)
    if (!overlayResponse.ok) throw new Error('Could not read the overlay image.')
    const overlay = await overlayResponse.blob()

    const { error: originalError } = await bucket.upload(originalPath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
    if (originalError) throw originalError
    uploadedPaths.push(originalPath)

    const { error: overlayError } = await bucket.upload(overlayPath, overlay, {
      contentType: 'image/png',
      upsert: false,
    })
    if (overlayError) throw overlayError
    uploadedPaths.push(overlayPath)

    const { error: insertError } = await client.from('characterization_reports').insert({
      id: reportId,
      user_id: userId,
      original_name: file.name,
      original_path: originalPath,
      overlay_path: overlayPath,
      overlay_style: overlayStyle,
      flipped,
      best_group: result.best.group,
      best_element: result.best.element,
      lp_per_mm: result.best.lp_per_mm,
      resolution_mm: result.best.resolution_mm,
      image_width: result.image.width,
      image_height: result.image.height,
      result,
    })
    if (insertError) throw insertError
    return reportId
  } catch (error) {
    if (uploadedPaths.length) {
      const { error: cleanupError } = await bucket.remove(uploadedPaths)
      if (cleanupError) {
        throw new Error(`${error.message || 'Save failed'} Cleanup also failed: ${cleanupError.message}`)
      }
    }
    throw error
  }
}
