"use strict"

/****** DATA ******/
export class Data {
  constructor(options) {
    this._options = options
    this._dataById = null
    this._cells = []
    this._geoJSON = null
    
    // init plugins
    this._overwriteColor = {}
    this._overwriteSize = {}
    this._overwriteContourColor = {}
    this._overwriteContourWidth = {}
  }
  getCells() {
    return this._cells
  }
  setCells(cells) {
    this._cells = cells
  }
  getGeoJSON() {
    return this._geoJSON
  }
  _minDataValue(key) {
    let min = Infinity
    for (const v of this._dataById.values()) {
      if (v[key] === null) continue
      const w = this._dataMap(v)[key]
      if (w < min) min = w
    }
    return min
  }
  _maxDataValue(key) {
    let max = -Infinity
    for (const v of this._dataById.values()) {
      if (v[key] === null) continue
      const w = this._dataMap(v)[key]
      if (w > max) max = w
    }
    return max
  }
  updateScales() {
    if (!this._dataById) return
    const t = this
    const computeScale = (scale, min, max, key) => {
      if (key === null) return null
      if (scale.length != 2) return scale
      const minComputed = (min != null) ? min : this._minDataValue(key)
      const maxComputed = (max != null) ? max : this._maxDataValue(key)
      return scale(minComputed, maxComputed)
    }
    this._cellColorScale = computeScale(this._options.cellColorScale, this._options.cellColorMin, this._options.cellColorMax, this._options.cellColorKey)
    this._cellSizeScale = computeScale(this._options.cellSizeScale, this._options.cellSizeMin, this._options.cellSizeMax, this._options.cellSizeKey)
  }
  getOverwriteColor() {
    return this._overwriteColor
  }
  getOverwriteSize() {
    return this._overwriteSize
  }
  getOverwriteContourColor() {
    return this._overwriteContourColor
  }
  getOverwriteContourWidth() {
    return this._overwriteContourWidth
  }
  overwriteColor(id, color) {
    if (color !== null) this._overwriteColor[id] = color
    else delete this._overwriteColor[cell.id]
  }
  overwriteSize(id, size) {
    if (size !== null) this._overwriteSize[id] = size
    else delete this._overwriteSize[cell.id]
  }
  overwriteContourColor(id, color) {
    if (color !== null) this._overwriteContourColor[id] = color
    else delete this._overwriteContourColor[cell.id]
  }
  overwriteContourWidth(id, width) {
    if (width !== null) this._overwriteContourWidth[id] = width
    else delete this._overwriteContourWidth[cell.id]
  }
  resetOverwriteColor() {
    this._overwriteColor = {}
  }
  resetOverwriteSize() {
    this._overwriteSize = {}
  }
  resetOverwriteContourColor() {
    this._overwriteContourColor = {}
  }
  resetOverwriteContourWidth() {
    this._overwriteContourWidth = {}
  }
  cellColor(id, properties) {
    // return overwritten colour
    if (id in this._overwriteColor) return this._overwriteColor[id]
    // no key
    if (this._options.cellColorKey === null) return this._options.cellColorNoKey
    // compute value
    const value = properties[this._options.cellColorKey]
    // return if empty value
    if (value === null || value === undefined) return this._options.cellColorNoData
    // return if no scale
    if (this._cellColorScale === null) return this._options.cellColorNoKey
    // compute colour
    return this._cellColorScale(value)
  }
  cellSize(id, properties, geometry) {
    let relativeSize
    // choose overwritten relative size
    if (id in this._overwriteSize) relativeSize = this._overwriteSize[id]
    // no key
    else if (this._options.cellSizeKey === null) relativeSize = this._options.cellSizeNoKey
    else {
      // compute value
      const value = properties[this._options.cellSizeKey]
      // empty value
      if (value === null || value === undefined) relativeSize = this._options.cellSizeNoData
      // no scale
      else if (this._cellSizeScale === null) relativeSize = this._options.cellSizeNoKey
      // compute relative size
      else relativeSize = this._cellSizeScale(value)
    }
    // if no resize needed, return geometry
    if (relativeSize == 1) return geometry
    // resize geometry
    const centroid = geometry.reduce(([x0, y0], [x1, y1]) => [x0 + x1, y0 + y1]).map(c => c / geometry.length)
    return geometry.map(([x, y]) => [relativeSize * (x - centroid[0]) + centroid[0], relativeSize * (y - centroid[1]) + centroid[1]])
  }
  cellContourColor(id, returnNullOnDefault=false) {
    // return overwritten contour colour
    if (id in this._overwriteContourColor) return this._overwriteContourColor[id]
    // return default value
    return returnNullOnDefault ? null : this._options.cellContourColor
  }
  cellContourWidth(id, returnNullOnDefault=false) {
    // return overwritten contour width
    if (id in this._overwriteContourWidth) return this._overwriteContourWidth[id]
    // return default value
    return returnNullOnDefault ? null : this._options.cellContourWidth
  }
  cacheData() {
    if (this._options.data === null || this._options.data === true) return null
    this._dataById = new Map()
    const ds = this._options.data.data
    const data = {
      data: new Array(ds.length)
    }
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i]
      this._dataById.set(d.id, d)
      if (d.lat !== undefined) {
        data.data[i] = {
          id: d.id,
          lat: d.lat,
          lon: d.lon,
        }
        if (d.isPentagon !== undefined) data.data[i].isPentagon = d.isPentagon
      } else data.data[i] = d.id
    }
    for (const k of Object.keys(this._options.data)) if (k != 'data') data[k] = this._options.data[k]
    this._options.data = true
    return data
  }
  dataKeys() {
    if (this._options.dataKeys !== null) return this._options.dataKeys
    if (this._cells.length == 0) return []
    return Object.keys(this._dataMap(this._dataById.get(this._cells[0].id))).filter(k => !['lat', 'lon', 'isPentagon'].includes(k))
  }
  produceGeoJSON() {
    // update scales
    this.updateScales()
    // produce GeoJSON
    const features = []
    for (let c of this._cells) {
      if (c.vertices !== undefined) features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [c.vertices],
        },
        properties: {id: c.id, ...this.dataForId(c.id)},
      })
    }
    this._geoJSON = {
      type: 'FeatureCollection',
      features: features,
    }
  }
  _dataMap(d) {
    if (this._options.dataMap !== null) return this._options.dataMap(d)
    return d
  }
  dataForId(id) {
    const d = this._dataById.get(id)
    if (d === undefined) return {}
    const d2 = this._dataMap(d)
    const properties = {}
    for (const k of this.dataKeys()) properties[k] = d2[k]
    return properties
  }
  dataForIdNotMapped(id) {
    const d = this._dataById.get(id)
    if (d === undefined) return {}
    return d
  }
  reduceGeoJSON(b) {
    if (!this._geoJSON) return
    // return cached GeoJSON in case of unchanged bounds
    if (b.equals(this._bboxView)) return this._geoJSONreduced
    this._bboxView = b
    // reduce
    this._geoJSONreduced = {
      type: 'FeatureCollection',
      features: [],
    }
    for (let f of this._geoJSON.features) if (b.intersects(L.latLngBounds(f.geometry.coordinates[0].map(c => [c[1], c[0]])))) this._geoJSONreduced.features.push(f)
    // return
    return this._geoJSONreduced
  }
}
