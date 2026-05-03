import { memo } from 'react'

interface UserMessageProps {
  content: string
}

export const UserMessage = memo(function UserMessage({ content }: UserMessageProps) {
  return (
    <div className="message-bubble">
      {content}
    </div>
  )
})
