import { Inter } from 'next/font/google'
import "./globals.css"
import { NavBar } from "@/components/nav-bar"
import { Toaster } from 'sonner'
import { checkEnvironmentVariables } from '@/lib/env-check'
import { AuthProvider } from '@/components/providers/auth-provider'

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
      <body className={inter.className} suppressHydrationWarning>
        <AuthProvider>
          <div className="min-h-screen bg-black text-white">
            <NavBar />
            <main className="container mx-auto pt-20 px-4">
              {children}
            </main>
            <Toaster />
          </div>
        </AuthProvider>
      </body>
    </html>
  )
}

