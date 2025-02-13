'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useAuth } from '@/components/providers/auth-provider'
import { toast } from 'sonner'
import { MoreHorizontal, MessageSquare, Edit2, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatDistanceToNow } from 'date-fns'

interface Comment {
  id: string
  content: string
  created_at: string
  updated_at: string
  is_edited: boolean
  user: {
    id: string
    username: string | null
    wallet_address: string
    avatar_url: string | null
  }
  parent_id: string | null
  replies?: Comment[]
}

interface CommentsProps {
  agentId: string
  comments: Comment[]
  onCommentAdded?: () => void
  onCommentUpdated?: () => void
  onCommentDeleted?: () => void
}

interface CommentsByParent {
  [key: string]: Comment[]
}

export function Comments({ agentId, comments, onCommentAdded, onCommentUpdated, onCommentDeleted }: CommentsProps) {
  const { user } = useAuth()
  const [newComment, setNewComment] = useState('')
  const [editingComment, setEditingComment] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Group comments by parent_id
  const commentsByParent = comments.reduce((acc: CommentsByParent, comment) => {
    const key = comment.parent_id || 'root'
    if (!acc[key]) acc[key] = []
    acc[key].push(comment)
    return acc
  }, {})

  const handleSubmit = async () => {
    if (!user) {
      toast.error('Please connect your wallet to comment')
      return
    }

    const walletAddress = user.user_metadata?.wallet_address
    if (!walletAddress) {
      toast.error('No wallet address found')
      return
    }

    if (!newComment.trim()) {
      toast.error('Comment cannot be empty')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: agentId,
          content: newComment,
          wallet_address: walletAddress
        }),
      })

      if (!response.ok) throw new Error('Failed to post comment')

      setNewComment('')
      onCommentAdded?.()
      toast.success('Comment posted successfully')
    } catch (error) {
      console.error('Error posting comment:', error)
      toast.error('Failed to post comment')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEdit = async (commentId: string) => {
    if (!editContent.trim()) {
      toast.error('Comment cannot be empty')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/agent/comments/${commentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: editContent,
        }),
      })

      if (!response.ok) throw new Error('Failed to update comment')

      setEditingComment(null)
      setEditContent('')
      onCommentUpdated?.()
      toast.success('Comment updated successfully')
    } catch (error) {
      console.error('Error updating comment:', error)
      toast.error('Failed to update comment')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (commentId: string) => {
    if (!confirm('Are you sure you want to delete this comment?')) return

    try {
      const response = await fetch(`/api/agent/comments/${commentId}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to delete comment')

      onCommentDeleted?.()
      toast.success('Comment deleted successfully')
    } catch (error) {
      console.error('Error deleting comment:', error)
      toast.error('Failed to delete comment')
    }
  }

  const handleReply = async (parentId: string) => {
    if (!user) {
      toast.error('Please connect your wallet to reply')
      return
    }

    if (!replyContent.trim()) {
      toast.error('Reply cannot be empty')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/agent/comments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: agentId,
          content: replyContent,
          parent_id: parentId,
        }),
      })

      if (!response.ok) throw new Error('Failed to post reply')

      setReplyingTo(null)
      setReplyContent('')
      onCommentAdded?.()
      toast.success('Reply posted successfully')
    } catch (error) {
      console.error('Error posting reply:', error)
      toast.error('Failed to post reply')
    } finally {
      setIsSubmitting(false)
    }
  }

  const renderComment = (comment: Comment, isReply = false) => {
    const isEditing = editingComment === comment.id
    const isReplying = replyingTo === comment.id
    const replies = commentsByParent[comment.id] || []
    const isOwner = user?.user_metadata?.wallet_address === comment.user.wallet_address

    return (
      <div key={comment.id} className={`space-y-2 ${isReply ? 'ml-8 mt-2' : 'mt-4'}`}>
        <div className="flex items-start gap-3">
          <Avatar className="h-8 w-8">
            <AvatarImage src={comment.user.avatar_url || undefined} />
            <AvatarFallback>
              {comment.user.username?.[0]?.toUpperCase() || comment.user.wallet_address.slice(0, 2)}
            </AvatarFallback>
          </Avatar>
          
          <div className="flex-1 space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {comment.user.username || (
                    <a
                      href={`https://solscan.io/account/${comment.user.wallet_address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-red-500 hover:text-red-400"
                    >
                      {comment.user.wallet_address.slice(0, 8)}
                    </a>
                  )}
                </span>
                <span className="text-xs text-gray-400">
                  {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                  {comment.is_edited && ' (edited)'}
                </span>
              </div>
              
              {isOwner && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => {
                      setEditingComment(comment.id)
                      setEditContent(comment.content)
                    }}>
                      <Edit2 className="h-4 w-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      className="text-red-600"
                      onClick={() => handleDelete(comment.id)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-2">
                <Textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  placeholder="Edit your comment..."
                  className="min-h-[100px]"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingComment(null)
                      setEditContent('')
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleEdit(comment.id)}
                    disabled={isSubmitting}
                  >
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm">{comment.content}</p>
                {user && !isReply && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-gray-400 hover:text-red-500"
                    onClick={() => setReplyingTo(isReplying ? null : comment.id)}
                  >
                    <MessageSquare className="h-4 w-4 mr-2" />
                    Reply
                  </Button>
                )}
              </>
            )}

            {isReplying && (
              <div className="space-y-2 mt-2">
                <Textarea
                  value={replyContent}
                  onChange={(e) => setReplyContent(e.target.value)}
                  placeholder="Write a reply..."
                  className="min-h-[100px]"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setReplyingTo(null)
                      setReplyContent('')
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleReply(comment.id)}
                    disabled={isSubmitting}
                  >
                    Reply
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Render replies */}
        {replies.length > 0 && (
          <div className="space-y-2">
            {replies.map(reply => renderComment(reply, true))}
          </div>
        )}
      </div>
    )
  }

  return (
    <Card className="bg-black/50 border-red-600/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Comments
        </CardTitle>
      </CardHeader>
      <CardContent>
        {user ? (
          <div className="space-y-4">
            <Textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Write a comment..."
              className="min-h-[100px]"
            />
            <div className="flex justify-end">
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting}
              >
                Post Comment
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center text-gray-400 py-4">
            Please connect your wallet to comment
          </div>
        )}

        <div className="mt-8 space-y-4">
          {commentsByParent['root']?.length ? (
            commentsByParent['root'].map(comment => renderComment(comment))
          ) : (
            <div className="text-center text-gray-400 py-4">
              No comments yet. Be the first to comment!
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
} 