export type ViewState =
  | { type: 'menu' }
  | { type: 'help' }
  | { type: 'validate'; path?: string }
  | { type: 'discover-plugins'; targetPlugin?: string }
  | {
      type: 'browse-marketplace'
      targetMarketplace: string
      targetPlugin?: string
    }
  | {
      type: 'manage-plugins'
      targetPlugin?: string
      targetMarketplace?: string
      action?: 'uninstall' | 'enable' | 'disable'
    }
  | {
      type: 'manage-marketplaces'
      targetMarketplace?: string
      action?: 'remove' | 'update'
    }
  | { type: 'add-marketplace'; initialValue?: string }
  | { type: 'marketplace-list' }
  | { type: 'marketplace-menu' }

export type PluginSettingsProps = {
  onComplete: (result?: string) => void
  args?: string
  showMcpRedirectMessage?: boolean
}
