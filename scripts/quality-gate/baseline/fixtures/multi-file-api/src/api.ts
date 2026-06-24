export type User = {
  name: string
  email: string
}

export type UserDisplay = {
  displayName: string
}

export function formatUser(user: User) {
  return {
    displayName: user.name,
  } satisfies UserDisplay
}
