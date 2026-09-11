/* The slice of the ExcelJS surface poseExport.js uses. Testing against this
   checks OUR row logic rather than the library's serialiser. */
class Row {
  constructor(values) { this._v = values; this.font = null; this.fill = null; this.alignment = null; }
  get values() { return this._v; }
  getCell(i) { const self = this; return { set font(f) { self.font = f; }, get value() { return self._v[i - 1]; } }; }
}
class Sheet {
  constructor(name) { this.name = name; this._cols = []; this._rows = []; this.views = null; }
  set columns(c) { this._cols = c; }
  get columns() { return this._cols; }
  get rowCount() { return this._rows.length + 1; }   // +1 for the header
  addRow(data) {
    const values = Array.isArray(data)
      ? data
      : this._cols.map((c) => (data && Object.prototype.hasOwnProperty.call(data, c.key) ? data[c.key] : undefined));
    const r = new Row(values);
    this._rows.push(r);
    return r;
  }
  getRow(n) {
    if (n === 1) return new Row(this._cols.map((c) => c.header));
    return this._rows[n - 2] || new Row([]);
  }
}
export class Workbook {
  constructor() { this.sheets = new Map(); }
  addWorksheet(name) { const s = new Sheet(name); this.sheets.set(name, s); return s; }
  getWorksheet(name) { return this.sheets.get(name); }
}
