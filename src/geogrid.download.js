"use strict"

const cacheSize = 2.5

const radians = degrees => degrees * Math.PI / 180

const latLonToTileID = (lat, lon, zoom) => {
  const n = 2**zoom
  const x = Math.floor(n * (lon + 180) / 360)
  const y = Math.floor(n / 2 * (1 - Math.log(Math.tan(radians(lat)) + 1 / Math.cos(radians(lat))) / Math.PI))
  return [x, y]
}

const cacheObjectJSONable = (options, source) => ({
  url: source.url,
  tileZoom: source.tileZoom,
  parameters: source.parameters,
})
const cacheObjectNonJSONable = (options, source) => ({
  resolution: options.resolution,
})
const cacheObjectNonJSONableKeys = [
  'resolution',
]

let instanceDownload = null

/****** Download ******/
export class Download {
  constructor(progress) {
    if (instanceDownload === null) {
      instanceDownload = this
      this._progress = progress
      this._cache = {}
      this._cacheObjects = {}
      this._cacheObjectsN = 0
    }
    return instanceDownload
  }
  __getOrSaveCacheObject(object) {
    for (const [n, v] of Object.entries(this._cacheObjects)) if (v == object) return n
    const n = this._cacheObjectsN.toString()
    this._cacheObjects[n] = object
    this._cacheObjectsN++
    return n
  }
  __fetchCacheObject(n) {
    return this._cacheObjects[n]
  }
  __removeCacheObject(n) {
    delete this._cacheObjects[n]
  }
  __cleanupCache(cJSON, sourceN) {
    let cleanupCacheObjectNs = []
    // remove sourceN from unused caches
    for (const [k, v] of Object.entries(this._cache)) if (k != cJSON && v.sourceN == sourceN) {
      v._cachedFor.delete(sourceN)
      if (v._cachedFor.size == 0) cleanupCacheObjectNs = cleanupCacheObjectNs.concat(cacheObjectNonJSONableKeys.map(k2 => v[k2]))
      delete this._cache[k]
    }
    // delete unused caches and corresponding cache objects
    const usedCacheObjectNs = Object
      .values(this._cache)
      .flatMap(v => cacheObjectNonJSONableKeys.map(k => v[k]))
    for (const n of cleanupCacheObjectNs) if (!usedCacheObjectNs.includes(n)) this.__removeCacheObject(n)
  }
  _getCache(options, source, sourceN) {
    // create default cache
    const c = {
      ...cacheObjectJSONable(options, source),
    }
    // save objects to cache
    for (const [k, v] of Object.entries(cacheObjectNonJSONable(options, source))) c[k] = this.__getOrSaveCacheObject(v)
    // compute key
    const cJSON = JSON.stringify(c)
    // store to cache if necessary
    if (!(cJSON in this._cache)) this._cache[cJSON] = {
      ...c,
      _cachedFor: new Set(),
      _cachedData: {},
      _callbacksDownloading: {},
    }
    // add sourceN to _cachedFor
    this._cache[cJSON]._cachedFor.add(sourceN)
    // produce result
    const c2 = {...this._cache[cJSON]}
    // fetch objects from cache
    for (const k of cacheObjectNonJSONableKeys) c2[k] = this.__fetchCacheObject(c2[k])
    // cleanup cache
    this.__cleanupCache(cJSON, sourceN)
    // return result
    return [cJSON, c2]
  }
  load(options, source, sourceN, resolutionData, bbox, callback) {
    // get cache
    const [cJSON, c] = this._getCache(options, source, sourceN)
    // produce urls
    let urls
    let url = c.url.replace('{resolution}', resolutionData)
    for (const p in c.parameters) url = url.replace(`{${p}}`, (c.parameters[p] !== null) ? c.parameters[p] : '')
    if (c.url.includes('{bbox}')) urls = [url.replace('{bbox}', bbox.toBBoxString())]
    else {
      url = c.url.replace('{z}', c.tileZoom)
      const [xMin, yMin] = latLonToTileID(bbox.getNorth(), bbox.getWest(), c.tileZoom)
      const [xMax, yMax] = latLonToTileID(bbox.getSouth(), bbox.getEast(), c.tileZoom)
      const xy = []
      for (let x = xMin; x <= xMax; x++) for (let y = yMin; y <= yMax; y++) xy.push([x, y])
      urls = xy.map(([x, y]) => url.replace('{x}', x).replace('{y}', y))
    }
    this._download(options, cJSON, urls, callback)
  }
  _download(options, cJSON, urls, callback) {
    const ds = {}
    // prepare the final data
    const useData = (url, data) => {
      ds[url] = data
      if (Object.keys(ds).length < urls.length) return
      let result = null
      for (const d of Object.values(ds)) if (d !== null && d.data !== null) {
        if (result === null) result = {...d}
        else result.data = result.data.concat(d.data)
      }
      try {
        callback(result)
        if (Object.keys(this._cache[cJSON]._cachedData).length > cacheSize * urls.length) this._cache[cJSON]._cachedData = {}
      } catch (e) {
        console.error(e)
      }
    }
    // start downloads
    for (const url of urls) {
      if (url in this._cache[cJSON]._cachedData) {
        if ((options.debug || !options.silent) && this._progress) this._progress.log(`cached: ${url}`)
        useData(url, this._cache[cJSON]._cachedData[url])
      } else if (url in this._cache[cJSON]._callbacksDownloading) this._cache[cJSON]._callbacksDownloading[url].push((url, data) => useData(url, data))
      else {
        this._cache[cJSON]._callbacksDownloading[url] = []
        d3.json(url).then(data => {
          if ((options.debug || !options.silent) && this._progress) this._progress.log(`download: ${url}`)
          this._cache[cJSON]._cachedData[url] = data
          useData(url, data)
          for (const cb of this._cache[cJSON]._callbacksDownloading[url]) {
            if ((options.debug || !options.silent) && this._progress) this._progress.log(`cached: ${url}`)
            cb(url, data)
          }
          delete this._cache[cJSON]._callbacksDownloading[url]
        }).catch(e => {
          this._progress.error(e)
          useData(url, null)
        })
      }
    }
  }
}
