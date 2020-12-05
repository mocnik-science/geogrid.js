"use strict"

/****** WORKER ******/
module.exports.isea3hWorker = () => {
  importScripts('./vptree.js/vptree.min.js')

  // helping functions
  const log = message => postMessage({task: 'log', message: message})
  const error = message => {throw message}
  const progress = percent => postMessage({task: 'progress', percent: percent})
  const debugStep = (title, percent) => postMessage({task: 'debugStep', title: title, percent: percent})

  // message handler
  onmessage = e => {
    const d = e.data
    switch (d.task) {
      case 'computeCells':
        postMessage({
          task: 'resultComputeCells',
          cells: computeGeoJSON(d.json, d.bbox),
        })
        break
      case 'findCell':
        postMessage({
          task: d.taskResult,
          cell: findCell(d.lat, d.lon),
          lat: d.lat,
          lon: d.lon,
        })
        break
      case 'findNeighbors':
        postMessage({
          task: 'resultFindNeighbors',
          uid: d.uid,
          neighbors: findNeighbors(d.idLong),
        })
        break
    }
  }

  // constants
  const rad = Math.PI / 180
  const radCircle = 2 * Math.PI

  // caches
  let cacheNeighbors = {}
  let cacheVertices = {}
  let keysToCopy = []
  let data = null
  let cells = null
  let tree = null

  // helping function: clean up data about cells
  const cleanupCell = c => {
    const cell = {
      id: c.id,
      lat: c.lat,
      lon: c.lon,
      isPentagon: c.isPentagon,
    }
    if (c.filtered !== false) cell.vertices = c.vertices
    for (k of keysToCopy) cell[k] = c[k]
    return cell
  }

  // compute GeoJSON
  const computeGeoJSON = (json, bbox) => {
    // handle errors
    if (json == null) error('data error - no data')
    if (json.error) error(`data error - ${json.message}`)

    // get properties to copy
    keysToCopy = (json.data.length > 0) ? Object.keys(json.data[0]).filter(k => !(k in ['lat', 'lon'])) : []

    // make data complete by repetition
    debugStep('make data complete by repetition', 10)
    data = []
    const minLonN = Math.floor((bbox.west + 180) / 360)
    const maxLonN = Math.ceil((bbox.east - 180) / 360)
    const diameterCell = Math.pow(1 / Math.sqrt(3), json.resolution - 1) * 36 * 2 / 3
    const west = bbox.west - diameterCell
    const east = bbox.east + diameterCell
    const south = bbox.south - diameterCell
    const north = bbox.north + diameterCell
    const repeatNumber = Math.ceil((bbox.east - bbox.west) / 360)
    const explicitLatLon = json.data.length > 0 && json.data[0].lat !== undefined
    for (let i = minLonN; i <= maxLonN; i++) for (let d of json.data) {
      const isPentagon = d.id.startsWith('-')
      let lon
      let lat
      if (explicitLatLon) {
        lon = d.lon
        lat = d.lat
      } else {
        let idWithoutSign = (isPentagon) ? d.id.substr(1) : d.id
        if (idWithoutSign.length % 2 == 0) idWithoutSign = '0' + idWithoutSign
        const numberOfDecimalPlaces = (idWithoutSign.length - 2 - 5) / 2
        lat = parseInt(idWithoutSign.substr(2, numberOfDecimalPlaces + 2)) / Math.pow(10, numberOfDecimalPlaces)
        lon = parseInt(idWithoutSign.substr(2 + numberOfDecimalPlaces + 2)) / Math.pow(10, numberOfDecimalPlaces)
        const partB = parseInt(idWithoutSign.substr(0, 2))
        if ((partB >= 22 && partB < 44) || partB >= 66) lat *= -1
        if (partB >= 44) lon *= -1
      }
      const lonNew = lon + i * 360
      if (west <= lonNew && lonNew <= east && south <= lat && lat <= north) {
        dNew = {
          idLong: `${d.id}_${i}`,
          lat: lat,
          lon: lonNew,
          sinLat: Math.sin(lat * rad),
          cosLat: Math.cos(lat * rad),
          lonN: i,
          isPentagon: isPentagon,
          neighbors: cacheNeighbors[d.id],
          vertices: cacheVertices[d.id],
        }
        for (k of keysToCopy) dNew[k] = d[k]
        data.push(dNew)
      }
    }

    // load the data into a tree
    debugStep('load data into tree', 15)
    const Mathmin = (a, b) => (a < b) ? a : b
    tree = VPTreeFactory.build(data, (d0, d1) => Math.acos(Mathmin(d0.sinLat * d1.sinLat + d0.cosLat * d1.cosLat * Math.cos((d1.lon - d0.lon) * rad), 1)))

    // collect the data needed for a cell
    // in particular: find neighbours for the cells
    debugStep('collect the data needed for a cell', 20)
    cells = {}
    for (let d of data) {
      const numberOfNeighborsToLookFor = d.isPentagon ? 5 : 6
      if (d.neighbors == undefined) {
        d.neighbors = []
        for (let x of tree.search(d, 6 * (repeatNumber + 1) + 1).splice(1)) {
          const n = data[x.i]
          if (n.id !== d.id && Math.abs(d.lon - n.lon) < 180) d.neighbors.push(n.idLong)
          if (d.neighbors.length >= numberOfNeighborsToLookFor) break
        }
      }
      cells[d.idLong] = d
    }

    // filter cells I
    // filter cells by location of neighbours
    debugStep('filter cells I', 40)
    for (const id in cells) {
      const c = cells[id]
      if (c.vertices !== undefined) continue
      let numberOfMatchingNeighbors = 0
      for (let id2 of c.neighbors) if (cells[id2].neighbors.indexOf(id) >= 0) numberOfMatchingNeighbors++
      if (numberOfMatchingNeighbors < (c.isPentagon ? 5 : 6)) c.filtered = false
    }

    // compute angles and vertices
    debugStep('compute angles and vertices', 45)
    for (let id in cells) {
      const c = cells[id]
      if (c.filtered === false || c.vertices !== undefined) continue
      c.angles = []
      // compute angles
      for (let id2 of c.neighbors) {
        let n = cells[id2]
        const ncLon = (n.lon - c.lon) * rad
        c.angles.push({
          angle: Math.atan2(Math.sin(ncLon) * n.cosLat, c.cosLat * n.sinLat - c.sinLat * n.cosLat * Math.cos(ncLon)),
          lat: n.lat,
          lon: n.lon,
        })
      }
      // sort angles
      c.angles.sort((a, b) => (a.angle < b.angle) ? -1 : 1)
      // compute vertices
      c.vertices = []
      for (let i = 0; i <= c.angles.length; i++) {
        const n1 = c.angles[i % c.angles.length]
        const n2 = c.angles[(i + 1) % c.angles.length]
        c.vertices.push([(n1.lon + n2.lon + c.lon) / 3, (n1.lat + n2.lat + c.lat) / 3])
      }
    }

    // filter cells II
    // filter cells by their distortion
    debugStep('filter cells II', 50)
    for (let id in cells) {
      const c = cells[id]
      if (c.filtered === false) continue
      else if (c.isPentagon) continue
      else {
        let filter = true
        for (let i = 0; i < 6; i++) {
          const aBefore = Math.abs((c.angles[(i + 2 < 6) ? i + 2 : i - 4].angle - c.angles[i].angle + radCircle) % radCircle - Math.PI)
          const a = Math.abs((c.angles[(i + 3 < 6) ? i + 3 : i - 3].angle - c.angles[i].angle + radCircle) % radCircle - Math.PI)
          const aAfter = Math.abs((c.angles[(i + 4 < 6) ? i + 4 : i - 2].angle - c.angles[i].angle + radCircle) % radCircle - Math.PI)
          if ((aBefore < a) || (aAfter < a)) {
            filter = false
            break
          }
        }
        if (!filter) c.filtered = false
      }
    }

    // cache neighbours
    debugStep('cache neighbours', 55)
    for (let id in cells) cacheNeighbors[id] = cells[id].neighbors

    // cache vertices
    debugStep('cache vertices', 57.5)
    for (let id in cells) cacheVertices[id] = cells[id].vertices

    // clean up data about cells
    debugStep('clean up data about cells', 60)
    const cells2 = new Array(cells.length)
    let i = -1
    for (let id in cells) {
      i++
      cells2[i] = cleanupCell(cells[id])
    }

    return cells2
  }

  // find cell for given coordinates
  const findCell = (lat, lon) => {
    for (let x of tree.search({
      lat: lat,
      lon: lon,
      sinLat: Math.sin(lat * rad),
      cosLat: Math.cos(lat * rad),
    }, 1)) return data[x.i]
  }

  // find neighbors of a given cell
  const findNeighbors = idLong => cacheNeighbors[idLong].map(idLong2 => cleanupCell(cells[idLong2]))
}
