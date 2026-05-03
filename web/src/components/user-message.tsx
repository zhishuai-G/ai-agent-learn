interface UserMessageProps {
  content: string
}

export function UserMessage({ content }: UserMessageProps) {
  return (
    <div className="message-bubble">
      {content}
    </div>
  )
}
