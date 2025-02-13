'use client'

import { Button } from "@/components/ui/button"
import { Coins, PlusCircle } from 'lucide-react'
import Link from "next/link"
import { WalletButton } from './wallet-button'
import { Twitter, DiscIcon as Discord, Send } from 'lucide-react'
import TokenTicker from "./nasdaq-banner"

const SOCIALS = {
  twitter: 'https://twitter.com/swarms_corp',
  discord: 'https://discord.gg/aHzZttGr',
  telegram: 'https://t.me/swarmsgroupchat'
}

export function NavBar() {
  return (
    <nav className="fixed top-0 w-full border-b border-red-600/20 bg-black/50 backdrop-blur-xl z-50">
      <div className="container flex h-14 sm:h-16 items-center px-3 sm:px-4">
        <Link href="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
          <span className="text-xl sm:text-2xl font-bold text-red-600 tracking-tight">
            swarms exchange
          </span>
        </Link>

        {/* Social Links - Hidden on mobile */}
        <div className="hidden md:flex items-center ml-6 sm:ml-8 space-x-4">
          <Link 
            href={SOCIALS.twitter} 
            target="_blank"
            className="text-gray-400 hover:text-red-600 transition-colors p-1.5 hover:bg-red-600/10 rounded-full"
            aria-label="Twitter"
          >
            <Twitter className="h-4 w-4 sm:h-5 sm:w-5" />
          </Link>
          <Link 
            href={SOCIALS.discord} 
            target="_blank"
            className="text-gray-400 hover:text-red-600 transition-colors p-1.5 hover:bg-red-600/10 rounded-full"
            aria-label="Discord"
          >
            <Discord className="h-4 w-4 sm:h-5 sm:w-5" />
          </Link>
          <Link 
            href={SOCIALS.telegram} 
            target="_blank"
            className="text-gray-400 hover:text-red-600 transition-colors p-1.5 hover:bg-red-600/10 rounded-full"
            aria-label="Telegram"
          >
            <Send className="h-4 w-4 sm:h-5 sm:w-5" />
          </Link>
        </div>

        {/* Mobile Menu Button */}
        <div className="md:hidden ml-auto flex items-center">
          <Button 
            variant="ghost" 
            size="sm"
            className="text-gray-400 hover:text-red-600 p-1.5 hover:bg-red-600/10 rounded-full"
            onClick={() => window.open(SOCIALS.twitter, '_blank')}
            aria-label="Twitter"
          >
            <Twitter className="h-4 w-4" />
          </Button>
        </div>

        {/* Desktop Navigation */}
        <div className="hidden md:flex ml-auto items-center space-x-3 sm:space-x-4">
          <Link href="/holdings">
            <Button 
              variant="outline" 
              className="border-red-600/50 hover:border-red-600 hover:bg-red-600/20 text-red-600 transition-colors"
            >
              <Coins className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Holdings</span>
            </Button>
          </Link>
          <WalletButton />
          <Link href="/create">
            <Button 
              variant="outline" 
              className="border-red-600/50 hover:border-red-600 hover:bg-red-600/20 text-red-600 transition-colors"
            >
              <PlusCircle className="h-4 w-4 mr-0 sm:mr-2" />
              <span className="hidden sm:inline">Create Token</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Mobile Navigation */}
      <div className="md:hidden border-t border-red-600/20 bg-black/30 backdrop-blur-xl">
        <div className="container flex justify-between items-center py-2 px-3 sm:px-4">
          <Link href="/holdings">
            <Button 
              variant="outline" 
              size="sm"
              className="border-red-600/50 hover:border-red-600 hover:bg-red-600/20 text-red-600 transition-colors h-9 px-2.5"
              aria-label="Holdings"
            >
              <Coins className="h-4 w-4" />
            </Button>
          </Link>
          <WalletButton />
          <Link href="/create">
            <Button 
              variant="outline" 
              size="sm"
              className="border-red-600/50 hover:border-red-600 hover:bg-red-600/20 text-red-600 transition-colors h-9 px-2.5"
              aria-label="Create Token"
            >
              <PlusCircle className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </nav>
  )
}