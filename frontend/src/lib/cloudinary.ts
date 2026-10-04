import { apiPost } from './auth-api'

export type UploadKind = 'listings' | 'logos' | 'proofs' | 'videos'

type SignedUpload = {
  cloudName: string
  apiKey: string
  folder: string
  timestamp: number
  signature: string
  uploadUrl: string
}

type CloudinaryUploadResponse = {
  secure_url?: string
  resource_type?: string
  public_id?: string
  error?: { message?: string }
}

export async function uploadToCloudinary(file: File | Blob, kind: UploadKind, filename?: string): Promise<string> {
  const signed = await apiPost<SignedUpload>('/api/uploads/sign', { kind })
  const body = new FormData()
  body.append('file', file, filename || (file instanceof File ? file.name : 'upload'))
  body.append('api_key', signed.apiKey)
  body.append('timestamp', String(signed.timestamp))
  body.append('signature', signed.signature)
  body.append('folder', signed.folder)

  const res = await fetch(signed.uploadUrl, { method: 'POST', body })
  const json = (await res.json().catch(() => ({}))) as CloudinaryUploadResponse
  if (!res.ok || !json.secure_url) {
    throw new Error(json.error?.message || `Cloudinary upload failed (${res.status})`)
  }
  return json.secure_url
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  if (!res.ok) throw new Error('Could not prepare upload')
  return res.blob()
}
