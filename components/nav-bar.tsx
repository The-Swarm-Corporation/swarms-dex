'use client'

import { Button } from "@/components/ui/button"
import { Coins, PlusCircle } from 'lucide-react'
import Link from "next/link"
import { WalletButton } from './wallet-button'
import { HoldingsDialog } from './holdings-dialog'
import { Twitter, DiscIcon as Discord, Send } from 'lucide-react'

const SOCIALS = {
  twitter: 'https://twitter.com/swarms',
  discord: 'https://discord.gg/swarms',
  telegram: 'https://t.me/swarmsgroupchat'
}
// ... existing code ...

export function NavBar() {
  return (
    <nav className="fixed top-0 w-full border-b border-red-600/20 bg-black/50 backdrop-blur-xl z-50">
      <div className="container flex h-16 items-center px-4">
        <Link href="/" className="flex items-center space-x-2">
          <span className="text-2xl font-bold text-red-600">
            swarms exchange
          </span>
        </Link>

        {/* Social Links - Hidden on mobile */}
        <div className="hidden md:flex items-center ml-8 space-x-4">
          <Link 
            href={SOCIALS.twitter} 
            target="_blank"
            className="text-gray-400 hover:text-red-600 transition-colors"
          >
            <Twitter className="h-5 w-5" />
          </Link>
          <Link 
            href={SOCIALS.discord} 
            target="_blank"
            className="text-gray-400 hover:text-red-600 transition-colors"
          >
            <Discord className="h-5 w-5" />
          </Link>
          <Link 
            href={SOCIALS.telegram} 
            target="_blank"
            className="text-gray-400 hover:text-red-600 transition-colors"
          >
            <Send className="h-5 w-5" />
          </Link>
        </div>

        {/* Mobile Menu Button */}
        <div className="md:hidden ml-auto flex items-center">
          <Button 
            variant="ghost" 
            className="text-gray-400 hover:text-red-600"
            onClick={() => window.open(SOCIALS.twitter, '_blank')}
          >
            <Twitter className="h-5 w-5" />
          </Button>
        </div>

        {/* Desktop Navigation */}
        <div className="hidden md:flex ml-auto items-center space-x-4">
          <Link href="/holdings">
            <Button 
              variant="outline" 
              className="border-red-600 hover:bg-red-600/20 text-red-600"
            >
              <Coins className="h-4 w-4" />
              Holdings
            </Button>
          </Link>
          <WalletButton />
          <Link href="/create">
            <Button 
              variant="outline" 
              className="border-red-600 hover:bg-red-600/20 text-red-600"
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              Create Token
            </Button>
          </Link>
        </div>
      </div>

      {/* Mobile Navigation */}
      <div className="md:hidden border-t border-red-600/20">
        <div className="container flex justify-between items-center py-2 px-4">
          <Link href="/holdings">
            <Button 
              variant="outline" 
              size="sm"
              className="border-red-600 hover:bg-red-600/20 text-red-600"
            >
              <Coins className="h-4 w-4" />
            </Button>
          </Link>
          <WalletButton />
          <Link href="/create">
            <Button 
              variant="outline" 
              size="sm"
              className="border-red-600 hover:bg-red-600/20 text-red-600"
            >
              <PlusCircle className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </nav>
  )
}