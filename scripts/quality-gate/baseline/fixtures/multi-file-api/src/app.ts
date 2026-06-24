import { formatUser, type User } from './api'

export function renderUser(user: User) {
  return `User: ${formatUser(user).displayName}`
}
