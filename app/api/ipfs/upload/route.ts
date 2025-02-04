import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { PinataSDK } from 'pinata-web3'

const PINATA_JWT = process.env.PINATA_JWT as string
const PINATA_GATEWAY = process.env.PINATA_GATEWAY as string

if (!PINATA_JWT) {
  throw new Error('PINATA_JWT is required')
}

if (!PINATA_GATEWAY) {
  throw new Error('PINATA_GATEWAY is required')
}

const pinata = new PinataSDK({
  pinataJwt: PINATA_JWT,
  pinataGateway: PINATA_GATEWAY,
})

async function uploadToPinata(file: File) {
  try {
    // Upload image to Pinata
    logger.info('Uploading image to Pinata')
    const imageUpload = await pinata.upload.file(file)
    const imageIpfsHash = imageUpload.IpfsHash
    logger.info('Image upload successful:', imageIpfsHash)

    return `https://${PINATA_GATEWAY}/ipfs/${imageIpfsHash}`
  } catch (error) {
    logger.error('Failed to upload to Pinata', error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const image = formData.get('image') as File

    if (!image) {
      return NextResponse.json(
        { error: 'Image is required' },
        { status: 400 }
      )
    }

    const imageUrl = await uploadToPinata(image)

    return NextResponse.json({
      success: true,
      imageUrl
    })

  } catch (error) {
    logger.error('Error in upload handler', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to upload to IPFS' },
      { status: 500 }
    )
  }
}

// Increase payload size limit for file uploads
export const config = {
  api: {
    bodyParser: false
  }
} 