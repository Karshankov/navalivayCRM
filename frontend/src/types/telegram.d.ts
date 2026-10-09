declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready(): void
        expand(): void
        close(): void
        
        // User data
        initData: string
        initDataUnsafe: {
          user?: {
            id: number
            is_bot: boolean
            first_name: string
            last_name?: string
            username?: string
            language_code: string
            is_premium?: boolean
            photo_url?: string
          }
          start_param?: string
          auth_date: number
          hash: string
        }
        
        // Theme
        colorScheme: 'light' | 'dark'
        themeParams: {
          bg_color?: string
          text_color?: string
          hint_color?: string
          link_color?: string
          button_color?: string
          button_text_color?: string
          secondary_bg_color?: string
        }
        
        // Layout
        headerColor: string
        backgroundColor: string
        isExpanded: boolean
        viewportHeight: number
        viewportStableHeight: number
        
        // Fullscreen mode (Bot API 8.0+)
        isFullscreen: boolean
        isActive?: boolean
        requestFullscreen?(): void | Promise<void>
        exitFullscreen?(): void | Promise<void>
        safeAreaInset?: {
          top: number
          bottom: number
          left: number
          right: number
        }
        contentSafeAreaInset?: {
          top: number
          bottom: number
          left: number
          right: number
        }
        
        // Buttons
        MainButton: {
          text: string
          color: string
          textColor: string
          isVisible: boolean
          isActive: boolean
          isProgressVisible: boolean
          setText(text: string): void
          onClick(callback: () => void): void
          offClick(callback: () => void): void
          show(): void
          hide(): void
          enable(): void
          disable(): void
          showProgress(leaveActive?: boolean): void
          hideProgress(): void
        }
        
        BackButton: {
          isVisible: boolean
          onClick(callback: () => void): void
          offClick(callback: () => void): void
          show(): void
          hide(): void
        }
        
        SettingsButton: {
          isVisible: boolean
          onClick(callback: () => void): void
          offClick(callback: () => void): void
          show(): void
          hide(): void
        }
        
        // Haptic feedback
        HapticFeedback: {
          impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void
          notificationOccurred(type: 'error' | 'success' | 'warning'): void
          selectionChanged(): void
        }
        
        // Cloud storage
        CloudStorage: {
          setItem(key: string, value: string, callback?: (error: string | null) => void): void
          getItem(key: string, callback: (error: string | null, value: string | null) => void): void
          getItems(keys: string[], callback: (error: string | null, values: Record<string, string>) => void): void
          removeItem(key: string, callback?: (error: string | null) => void): void
          removeItems(keys: string[], callback?: (error: string | null) => void): void
          getKeys(callback: (error: string | null, keys: string[]) => void): void
        }
        
        // Navigation
        openLink(url: string, options?: { try_instant_view?: boolean }): void
        openTelegramLink(url: string): void
        
        // Popups
        showPopup(params: {
          title?: string
          message: string
          buttons?: Array<{
            id?: string
            type?: 'default' | 'ok' | 'close' | 'cancel' | 'destructive'
            text?: string
          }>
        }, callback?: (buttonId: string) => void): void
        
        showAlert(message: string, callback?: () => void): void
        showConfirm(message: string, callback?: (confirmed: boolean) => void): void
        
        // Scanning
        showScanQrPopup(params: {
          text?: string
        }, callback?: (data: string) => boolean): void
        
        closeScanQrPopup(): void
        
        // Clipboard
        readTextFromClipboard?(callback?: (data: string | null) => void): void
        
        // Biometry
        BiometricManager?: {
          isInited: boolean
          isBiometricAvailable: boolean
          biometricType: 'finger' | 'face' | 'unknown'
          isAccessRequested: boolean
          isAccessGranted: boolean
          isBiometricTokenSaved: boolean
          deviceId: string
          
          init(callback?: () => void): void
          requestAccess(params: {
            reason?: string
          }, callback?: (granted: boolean) => void): void
          authenticate(params: {
            reason?: string
          }, callback?: (success: boolean, token?: string) => void): void
          updateBiometricToken(token: string, callback?: (updated: boolean) => void): void
          openSettings(): void
        }
        
        // Events
        onEvent(eventType: string, callback: (...args: any[]) => void): void
        offEvent(eventType: string, callback: (...args: any[]) => void): void
        sendData(data: string): void
        
        // Version and platform
        version: string
        platform: string
        
        // Utils
        isVersionAtLeast(version: string): boolean
      }
    }
  }
}

export {}
