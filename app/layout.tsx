import { Inter } from 'next/font/google'
import "./globals.css"
import { NavBar } from "@/components/nav-bar"
import { Toaster } from 'sonner'
import { checkEnvironmentVariables } from '@/lib/env-check'
import { AuthProvider } from '@/components/providers/auth-provider'
import { WalletProviders } from '@/components/providers/wallet-provider'
import { Metadata } from 'next'

// Check environment variables
checkEnvironmentVariables()

const inter = Inter({ subsets: ["latin"] })

const siteConfig = {
  name: "Swarms DEX",
  description: "Launch and Trade Agent Tokens - The premier decentralized exchange for AI agent tokens. Trade, launch, and discover the future of automated finance.",
  url: "https://dex.swarms.world",
  ogImage: "https://dex.swarms.world/og.svg", // You'll need to create this
  twitter: {
    handle: "@swarms_corp",
    site: "@swarms_corp",
    cardType: "summary_large_image",
  },
}

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [
    "AI agents",
    "cryptocurrency",
    "DEX",
    "decentralized exchange",
    "trading",
    "tokens",
    "blockchain",
    "artificial intelligence",
    "automated finance",
    "Swarms",
    "Web3",
  ],
  authors: [{ name: "Swarms" }],
  creator: "Swarms",
  publisher: "Swarms",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  manifest: '/site.webmanifest',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteConfig.url,
    title: siteConfig.name,
    description: siteConfig.description,
    siteName: siteConfig.name,
    images: [
      {
        url: siteConfig.ogImage,
        width: 1200,
        height: 630,
        alt: siteConfig.name,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.name,
    description: siteConfig.description,
    images: [siteConfig.ogImage],
    creator: siteConfig.twitter.handle,
    site: siteConfig.twitter.site,
  },
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
  },
  alternates: {
    canonical: siteConfig.url,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="canonical" href={siteConfig.url} />
        <meta name="theme-color" content="#000000" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black" />
      </head>
      <body className={`${inter.className} bg-black`} suppressHydrationWarning>
        <WalletProviders>
          <AuthProvider>
            <div className="min-h-screen bg-black text-white overflow-x-hidden">
              <NavBar />
              <main className="container mx-auto pt-20 px-4">
                {children}
              </main>
              <Toaster />
            </div>
          </AuthProvider>
        </WalletProviders>
      </body>
    </html>
  )
}

