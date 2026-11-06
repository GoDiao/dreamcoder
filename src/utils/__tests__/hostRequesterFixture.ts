import { setHostRequester, type HostRequest } from '../hostRequests.js'

export function installFakeHost(respond: (request: HostRequest) => unknown): HostRequest[] {
  const requests: HostRequest[] = []
  setHostRequester(async (request, schema) => {
    requests.push(request)
    return schema.parse(respond(request))
  })
  return requests
}

export function useEnvFlag(envName: string) {
  const previous = process.env[envName]
  return {
    enable() {
      process.env[envName] = '1'
    },
    disable() {
      delete process.env[envName]
    },
    restore() {
      if (previous === undefined) delete process.env[envName]
      else process.env[envName] = previous
    },
  }
}
