"use strict"

const radians = degrees => degrees * Math.PI / 180

const latLonToTileID = (lat, lon, zoom) => {
  const n = 2**zoom
  const x = Math.floor(n * (lon + 180) / 360)
  const y = Math.floor(n / 2 * (1 - Math.log(Math.tan(radians(lat)) + 1 / Math.cos(radians(lat))) / Math.PI))
  return [x, y]
}

let instanceDownload = null

/****** Download ******/
export class Download {
  constructor(options, map, progress) {
    if (this._url == options.url &&
      this._silent == options.silent &&
      this._debug == options.debug &&
      this._resolution == options.resolution &&
      this._tileZoom == options.tileZoom &&
      JSON.stringify(this._parameters) == JSON.stringify(options.parameters)) return instanceDownload
    this._url = options.url
    this._silent = options.silent
    this._debug = options.debug
    this._resolution = options.resolution
    this._tileZoom = options.tileZoom
    this._parameters = options.parameters
    this._map = map
    this._progress = progress
    instanceDownload = this
  }
  load(bbox, callback) {
    const resolution = this._resolution(this._map.getZoom())
    if (this._url.includes('{bbox}')) {
      let url = this._url
        .replace('{bbox}', bbox.toBBoxString())
        .replace('{resolution}', resolution)
      this.download([url], data => callback(data, bbox, resolution))
    } else {
      const url = this._url
        .replace('{resolution}', resolution)
        .replace('{z}', this._tileZoom)
      const [xMin, yMin] = latLonToTileID(bbox.getNorth(), bbox.getWest(), this._tileZoom)
      const [xMax, yMax] = latLonToTileID(bbox.getSouth(), bbox.getEast(), this._tileZoom)
      const xy = []
      for (let x = xMin; x <= xMax; x++) for (let y = yMin; y <= yMax; y++) xy.push([x, y])
      this.download(xy.map(([x, y]) => url.replace('{x}', x).replace('{y}', y)), data => callback(data, resolution))
    }
  }
  download(urls, callback) {
    const ds = {}
    // prepare url
    urls = urls.map(url => {
      for (const p in this._parameters) url = url.replace(`{${p}}`, (this._parameters[p] !== null) ? this._parameters[p] : '')
      return url
    })
    // prepare the final data
    const useData = (url, data) => {
      ds[url] = data
      if (Object.keys(ds).length < urls.length) return
      let result = null
      for (const d of Object.values(ds)) if (result === null) result = d
      else result.data = result.data.concat(d.data)
      callback(result)
    }
    // start downloads
    for (const url of urls) {
      if (this._debug || !this._silent) this._progress.log(url)
      d3.json(url).then(data => useData(url, data)).catch(console.debug)
    }
  }
}
