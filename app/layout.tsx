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


export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
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

