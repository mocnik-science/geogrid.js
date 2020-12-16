"use strict"

/****** PROGRESS ******/
export class Progress {
  constructor(options, visual) {
    this.options = options
    this.visual = visual

    // init progress bar
    if (this.visual) {
      this._progressBar = document.createElement('div')
      this._progressBar.style.backgroundColor = this.options.colorProgressBar
      const backgroundColor = d3.color(this.options.colorProgressBar)
      backgroundColor.opacity = .7
      this._progressBar.style.boxShadow = `0 1px 4px ${backgroundColor}`
      document.getElementsByTagName('body')[0].appendChild(this._progressBar)
    }
    this.progress(100)
  }
  remove() {
    if (!this.visual) return
    clearTimeout(this._progresBarTimeoutReset)
    this._progressBar.remove()
  }
  log(message) {
    console.log(`[geogrid.js] ${message}`)
  }
  error(message) {
    throw `[geogrid.js] ${message}`
  }
  progress(percent=100) {
    if (!this.visual) return
    if (this._progresBarTimeoutReset !== undefined) {
      clearTimeout(this._progresBarTimeoutReset)
      this._progresBarTimeoutReset = undefined
    }
    if (this.noProgress) return
    if (0 < percent && percent < 100) this._progressBar.className = 'progressBar'
    else {
      this._progressBar.className = 'progressBarHidden'
      this._progresBarTimeoutReset = setTimeout(() => {
        this._progresBarTimeoutReset = undefined
        this._progressBar.style.width = '0%'
        this._progressBar.className = 'progressBarReset'
      }, 700)
    }
    this._progressBar.style.width = `${percent}%`
  }
  showProgress() {
    this.noProgress = false
  }
  debugStep(title, percent=null) {
    if (percent !== null) this.progress(percent)
    if (!this.options.silent) {
      const t = (new Date()).getTime()
      if (this._debugTimestamp != null && this._debugTitle != null) this.log(`${this._debugTitle} (${t - this._debugTimestamp}ms)`)
      this._debugTimestamp = t
      this._debugTitle = title
    }
  }
  debugFinished() {
    this.progress(100)
    if (!this.options.silent) {
      if (this._debugTimestamp != null && this._debugTitle != null) this.log(`${this._debugTitle} (${(new Date()).getTime() - this._debugTimestamp}ms)`)
      this._debugTimestamp = null
      this._debugTitle = null
    }
    this.noProgress = true
  }
}
