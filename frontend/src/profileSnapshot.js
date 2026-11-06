export function snapshotProfile(profile) {
  if (!profile) return null
  const { id, name, description, overlay_style, flip_setting } = profile
  return { id, name, description, overlay_style, flip_setting }
}
