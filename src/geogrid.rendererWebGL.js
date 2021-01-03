"use strict"

/****** RENDERER WEBGL ******/
export class RendererWebGL {
  constructor(options, progress, data, getGeoJSON) {
    this._options = options
    this._progress = progress
    this._data = data
    this._getGeoJSON = getGeoJSON
  }
  add(map) {
    const t = this
    const pixiColor = color => {
      const c = d3.color(color).rgb()
      return PIXI.utils.rgb2hex([c.r / 255, c.g / 255, c.b / 255])
    }
    const pixiContainer = new PIXI.Container()
    const pixiGraphics = new PIXI.Graphics()
    pixiContainer.addChild(pixiGraphics)
    let prevZoom = null
    let prevOverwriteColor = null
    let prevOverwriteSize = null
    let prevOverwriteContourColor = null
    let prevOverwriteContourWidth = null
    let prevOptions = null
    this._webgl = L.pixiOverlay(utils => {
      const geoJSON = t._getGeoJSON()
      // if no geoJSON present, do nothing
      if (geoJSON == null || geoJSON.features == null) return
      // log
      const renderer = utils.getRenderer()
      t._progress.debugStep(`visualize (${(renderer instanceof PIXI.CanvasRenderer) ? 'Canvas' : 'WebGL'})`, 90)
      // collect utils
      const zoom = utils.getMap().getZoom()
      const container = utils.getContainer()
      const project = utils.latLngToLayerPoint
      const scale = utils.getScale()
      // check whether a referesh is need
      const needsRefresh =
        prevZoom != zoom ||
        prevOverwriteColor != JSON.stringify(this._data.getOverwriteColor()) ||
        prevOverwriteSize != JSON.stringify(this._data.getOverwriteSize()) ||
        prevOverwriteContourColor != JSON.stringify(this._data.getOverwriteContourColor()) ||
        prevOverwriteContourWidth != JSON.stringify(this._data.getOverwriteContourWidth()) ||
        prevOptions === null ||
        [
          'cellContourColor', 'cellContourWidth', 'cellContourOpacity',
          'cellCentroidColor', 'cellCentroidRadius', 'cellCentroidOpacity',
          'cellColorKey', 'cellColorMin', 'cellColorMax', 'cellColorScale', 'cellColorNoData', 'cellColorNoKey', 'cellColorOpacity',
          'cellSizeKey', 'cellSizeMin', 'cellSizeMax', 'cellSizeScale', 'cellSizeNoData', 'cellSizeNoKey',
        ].some(k => prevOptions[k] != t._options[k])
      prevZoom = zoom
      prevOverwriteColor = JSON.stringify(this._data.getOverwriteColor())
      prevOverwriteSize = JSON.stringify(this._data.getOverwriteSize())
      prevOverwriteContourColor = JSON.stringify(this._data.getOverwriteContourColor())
      prevOverwriteContourWidth = JSON.stringify(this._data.getOverwriteContourWidth())
      prevOptions = {...t._options}
      // if new geoJSON, cleanup and initialize
      if (geoJSON._webglInitialized == null || needsRefresh) pixiGraphics.clear()
      // draw geoJSON features (content)
      for (const feature of geoJSON.features) {
        if (feature.properties._isCell) continue
        const notInitialized = feature._webglCoordinatesResized === undefined
        if (notInitialized) {
          const webglCoordinatesResized = t._data.cellSize(feature.properties._sourceN, feature.properties.id, feature.properties, feature.geometry.coordinates[0])
          feature._webglCoordinatesResized = (webglCoordinatesResized !== null) ? webglCoordinatesResized.map(c => project([c[1], c[0]])).map(c => [c.x, c.y]) : null
        }
        if (feature._webglCoordinatesResized === null) continue
        if (notInitialized || needsRefresh) {
          pixiGraphics.beginFill(pixiColor(t._data.cellColor(feature.properties._sourceN, feature.properties.id, feature.properties)), t._options.cellColorOpacity)
          pixiGraphics.drawPolygon([].concat(...feature._webglCoordinatesResized))
          pixiGraphics.endFill()
        }
      }
      // draw geoJSON features (centroids)
      if (t._options.cellCentroidColor !== null && t._options.cellCentroidRadius !== null && t._options.cellCentroidRadius > 0 && t._options.cellCentroidOpacity !== null && t._options.cellCentroidOpacity > 0) {
        pixiGraphics.lineStyle(0, 0x0, 1)
        pixiGraphics.beginFill(pixiColor(t._options.cellCentroidColor), t._options.cellCentroidOpacity)
        for (const feature of geoJSON.features) {
          if (!feature.properties._isCell) continue
          const notInitialized = feature._webglCentroid === undefined
          if (notInitialized) feature._webglCentroid = project([feature.properties._centroid[1], feature.properties._centroid[0]])
          if (notInitialized || needsRefresh) pixiGraphics.drawCircle(feature._webglCentroid.x, feature._webglCentroid.y, t._options.cellCentroidRadius / scale)
        }
        pixiGraphics.endFill()
      }
      // draw geoJSON features (cell contours)
      const overwrittenFeatures = []
      pixiGraphics.lineStyle(t._options.cellContourWidth / scale, pixiColor(t._options.cellContourColor), t._options.cellContourOpacity)
      for (const feature of geoJSON.features) {
        if (!feature.properties._isCell) continue
        const notInitialized = feature._webglCoordinates === undefined
        if (notInitialized || needsRefresh) {
          const contourColor = t._data.cellContourColor(feature.properties.id, true)
          const contourWidth = t._data.cellContourWidth(feature.properties.id, true)
          if (contourColor !== null || contourWidth !== null) overwrittenFeatures.push([feature, contourColor, contourWidth])
          else {
            if (notInitialized) feature._webglCoordinates = feature.geometry.coordinates[0].map(c => project([c[1], c[0]])).map(c => [c.x, c.y])
            pixiGraphics.drawPolygon([].concat(...feature._webglCoordinates))
          }
        }
      }
      // draw geoJSON features (overwritten cell contours)
      for (const [feature, contourColor, contourWidth] of overwrittenFeatures) {
        if (contourColor === null && contourWidth === null) continue
        pixiGraphics.lineStyle((contourWidth !== null ? contourWidth : t._options.cellContourWidth) / scale, contourColor !== null ? pixiColor(contourColor) : pixiColor(t._options.cellContourColor), t._options.cellContourOpacity)
        const notInitialized = feature._webglCoordinates === undefined
        if (notInitialized) feature._webglCoordinates = feature.geometry.coordinates[0].map(c => project([c[1], c[0]])).map(c => [c.x, c.y])
        pixiGraphics.drawPolygon([].concat(...feature._webglCoordinates))
      }
      geoJSON._webglInitialized = true
      renderer.render(container)
      t._progress.debugFinished()
    }, pixiContainer).addTo(map)
  }
  remove(map) {
    this._webgl.remove()
  }
  render(geoJSON) {
    this._webgl._update(null)
  }
  update(geoJSON) {}
}
