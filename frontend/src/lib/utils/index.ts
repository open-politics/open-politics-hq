import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { type Model } from '@/lib/types/models'
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}



/**
 * Sanitizes a URL by replacing spaces with '%20'
 * @param url - The URL to sanitize
 * @returns The sanitized URL
 */
export function sanitizeUrl(url: string): string {
  return url.replace(/\s+/g, '%20')
}

export function createModelId(model: Model): string {
  return `${model.providerId}:${model.id}`
}

export function getDefaultModelId(models: Model[]): string {
  if (!models.length) {
    throw new Error('No models available')
  }
  return createModelId(models[0])
}
