"""Convert the presentation's PPTX into a resolved JSON layout for the web deck.

Usage: python3 -I scripts/pptx_to_json.py <deck.pptx> <out.json> <media-dir>

Every placeholder is resolved against its layout and master, so each run in the
output carries its final size, weight, and color. Coordinates are in pixels on a
1920x1080 stage (1 px = 6350 EMU, 1 pt = 2 px).
"""
import json
import os
import shutil
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET

NS = {
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'c': 'http://schemas.openxmlformats.org/drawingml/2006/chart',
}
EMU_PX = 6350
DEFAULT_INSETS = {'l': 91440 / EMU_PX, 't': 45720 / EMU_PX, 'r': 91440 / EMU_PX, 'b': 45720 / EMU_PX}
SHAPE_TAGS = ('sp', 'pic', 'grpSp', 'graphicFrame', 'cxnSp')


def q(tag):
    pre, name = tag.split(':')
    return '{%s}%s' % (NS[pre], name)


def px(v):
    return round(int(v) / EMU_PX, 2)


class Part:
    """One XML part (slide, layout, or master) with its relationships."""

    def __init__(self, root_dir, path):
        self.path = path
        self.root = ET.parse(os.path.join(root_dir, path)).getroot()
        self.rels = {}
        rel_path = os.path.join(root_dir, os.path.dirname(path), '_rels', os.path.basename(path) + '.rels')
        if os.path.exists(rel_path):
            for r in ET.parse(rel_path).getroot():
                self.rels[r.get('Id')] = os.path.normpath(os.path.join(os.path.dirname(path), r.get('Target')))

    def parent_path(self):
        for target in self.rels.values():
            if 'slideLayouts/' in target or 'slideMasters/' in target:
                return target
        return None


def ph_key(sp):
    ph = sp.find('./p:nvSpPr/p:nvPr/p:ph', NS)
    if ph is None:
        return None
    return (ph.get('type', 'body'), ph.get('idx'))


def find_ph(part, key):
    if part is None:
        return None
    for sp in part.root.iter(q('p:sp')):
        k = ph_key(sp)
        if k is None:
            continue
        if key[1] is not None and k[1] == key[1]:
            return sp
        if key[0] in ('title', 'ctrTitle') and k[0] in ('title', 'ctrTitle'):
            return sp
    return None


def color_of(el):
    if el is None:
        return None
    c = el.find('a:srgbClr', NS)
    if c is not None:
        alpha = c.find('a:alpha', NS)
        return '#' + c.get('val') + ('%02X' % round(int(alpha.get('val')) / 100000 * 255) if alpha is not None else '')
    s = el.find('a:schemeClr', NS)
    if s is not None:
        return 'scheme:' + s.get('val')
    return None


def merge(base, over):
    out = dict(base)
    out.update({k: v for k, v in over.items() if v is not None})
    return out


def para_props(pPr):
    """Read paragraph-level properties (from a:pPr or a:lvlNpPr)."""
    if pPr is None:
        return {}, {}
    p = {}
    if pPr.get('algn'):
        p['align'] = pPr.get('algn')
    if pPr.get('marL') is not None:
        p['marL'] = px(pPr.get('marL'))
    if pPr.get('indent') is not None:
        p['indent'] = px(pPr.get('indent'))
    for key, tag in (('lineSpacing', 'a:lnSpc'), ('spaceBefore', 'a:spcBef'), ('spaceAfter', 'a:spcAft')):
        e = pPr.find(tag, NS)
        if e is not None:
            pct = e.find('a:spcPct', NS)
            pts = e.find('a:spcPts', NS)
            if pct is not None:
                p[key] = {'pct': int(pct.get('val')) / 100000}
            elif pts is not None:
                p[key] = {'px': int(pts.get('val')) / 100 * 2}
    if pPr.find('a:buNone', NS) is not None:
        p['bullet'] = False
    bu = pPr.find('a:buChar', NS)
    if bu is not None:
        p['bullet'] = bu.get('char')
    bc = pPr.find('a:buClr', NS)
    if bc is not None:
        p['bulletColor'] = color_of(bc)
    return p, run_props(pPr.find('a:defRPr', NS))


def run_props(rPr):
    if rPr is None:
        return {}
    r = {}
    if rPr.get('sz'):
        r['size'] = int(rPr.get('sz')) / 100 * 2
    if rPr.get('b') is not None:
        r['bold'] = rPr.get('b') == '1'
    if rPr.get('i') is not None:
        r['italic'] = rPr.get('i') == '1'
    if rPr.get('spc'):
        r['spacing'] = int(rPr.get('spc')) / 100 * 2
    if rPr.get('baseline'):
        r['baseline'] = int(rPr.get('baseline')) / 1000
    fill = rPr.find('a:solidFill', NS)
    if fill is not None:
        r['color'] = color_of(fill)
    u = rPr.get('u')
    if u and u != 'none':
        r['underline'] = True
    return r


def lvl_style(lst, lvl):
    if lst is None:
        return {}, {}
    return para_props(lst.find('a:lvl%dpPr' % (lvl + 1), NS))


def body_props(bodyPr):
    if bodyPr is None:
        return {}
    b = {}
    ins = {}
    for k, side in (('lIns', 'l'), ('tIns', 't'), ('rIns', 'r'), ('bIns', 'b')):
        if bodyPr.get(k) is not None:
            ins[side] = px(bodyPr.get(k))
    if ins:
        b['insets'] = ins
    if bodyPr.get('anchor'):
        b['anchor'] = bodyPr.get('anchor')
    if bodyPr.get('wrap'):
        b['wrap'] = bodyPr.get('wrap')
    na = bodyPr.find('a:normAutofit', NS)
    if na is not None and na.get('fontScale'):
        b['fontScale'] = int(na.get('fontScale')) / 100000
    return b


class Deck:
    def __init__(self, root_dir):
        self.dir = root_dir
        self.parts = {}
        theme = ET.parse(os.path.join(root_dir, 'ppt/theme/theme2.xml')).getroot()
        self.scheme = {}
        for el in theme.find('.//a:clrScheme', NS):
            name = el.tag.split('}')[1]
            c = el.find('a:srgbClr', NS)
            if c is not None:
                self.scheme[name] = '#' + c.get('val')
        self.scheme.update({'tx1': self.scheme.get('dk1'), 'bg1': self.scheme.get('lt1'),
                            'tx2': self.scheme.get('dk2'), 'bg2': self.scheme.get('lt2')})
        self.media = {}

    def part(self, path):
        if path is None:
            return None
        if path not in self.parts:
            self.parts[path] = Part(self.dir, path)
        return self.parts[path]

    def color(self, c):
        if c and c.startswith('scheme:'):
            return self.scheme.get(c[7:], '#000000')
        return c

    # ---- inheritance chain -------------------------------------------------
    def chain(self, slide_part, sp):
        """Return [(sp_element, part)] from master down to the slide for a placeholder."""
        key = ph_key(sp)
        out = [(sp, slide_part)]
        if key is None:
            return out
        layout = self.part(slide_part.parent_path())
        lsp = find_ph(layout, key)
        if lsp is not None:
            out.insert(0, (lsp, layout))
        master = self.part(layout.parent_path()) if layout is not None else None
        msp = find_ph(master, key)
        if msp is None and master is not None and key[0] not in ('title', 'ctrTitle'):
            for s in master.root.iter(q('p:sp')):
                k = ph_key(s)
                if k and k[0] == 'body':
                    msp = s
                    break
        if msp is not None:
            out.insert(0, (msp, master))
        return out

    def master_of(self, part):
        p = part
        while p is not None and 'slideMasters/' not in p.path:
            p = self.part(p.parent_path())
        return p

    # ---- text --------------------------------------------------------------
    def text(self, slide_part, sp, txBody, is_ph):
        """Resolve a txBody into paragraphs with fully resolved runs."""
        master = self.master_of(slide_part)
        key = ph_key(sp) if is_ph else None
        base_lst = None
        if master is not None:
            styles = master.root.find('p:txStyles', NS)
            if key is not None and key[0] in ('title', 'ctrTitle'):
                base_lst = styles.find('p:titleStyle', NS)
            elif key is not None:
                base_lst = styles.find('p:bodyStyle', NS)
            else:
                base_lst = styles.find('p:otherStyle', NS)
        chain = self.chain(slide_part, sp) if is_ph else [(sp, slide_part)]

        body = {'insets': dict(DEFAULT_INSETS), 'anchor': 't', 'wrap': 'square'}
        for el, _ in chain:
            bp = el.find('./p:txBody/a:bodyPr', NS)
            b = body_props(bp)
            if 'insets' in b:
                body['insets'] = merge(body['insets'], b.pop('insets'))
            body.update(b)

        paras = []
        for p in txBody.findall('a:p', NS):
            pPr = p.find('a:pPr', NS)
            lvl = int(pPr.get('lvl', '0')) if pPr is not None else 0
            pp, rp = lvl_style(base_lst, lvl)
            for el, _ in chain:
                lst = el.find('./p:txBody/a:lstStyle', NS)
                p2, r2 = lvl_style(lst, lvl)
                pp = merge(pp, p2)
                rp = merge(rp, r2)
            p3, r3 = para_props(pPr)
            pp = merge(pp, p3)
            rp = merge(rp, r3)
            runs = []
            for r in p:
                tag = r.tag.split('}')[1]
                if tag in ('r', 'fld'):
                    t = r.find('a:t', NS)
                    run = merge(rp, run_props(r.find('a:rPr', NS)))
                    run['t'] = t.text if t is not None and t.text else ''
                    if tag == 'fld':
                        run['field'] = r.get('type')
                    runs.append(self.finish_run(run, body))
                elif tag == 'br':
                    runs.append({'br': True})
            if not runs:
                end = merge(rp, run_props(p.find('a:endParaRPr', NS)))
                runs.append(self.finish_run(dict(end, t=''), body))
            para = {
                'align': pp.get('align', 'l'),
                'lineSpacing': pp.get('lineSpacing', {'pct': 1.0}),
                'spaceBefore': pp.get('spaceBefore'),
                'spaceAfter': pp.get('spaceAfter'),
                'marL': pp.get('marL', 0),
                'indent': pp.get('indent', 0),
                'runs': runs,
            }
            bullet = pp.get('bullet')
            if bullet:
                para['bullet'] = {'char': bullet, 'color': self.color(pp.get('bulletColor')) or runs[0].get('color')}
            paras.append(para)
        return body, paras

    def finish_run(self, run, body):
        scale = body.get('fontScale', 1)
        out = {
            't': run.get('t', ''),
            'size': round(run.get('size', 36) * scale, 2),
            'bold': bool(run.get('bold')),
            'color': self.color(run.get('color')) or self.scheme['tx1'],
        }
        for k in ('spacing', 'italic', 'underline', 'baseline', 'field'):
            if run.get(k):
                out[k] = run[k]
        return out

    # ---- geometry ------------------------------------------------------------
    def xfrm(self, el, chain=None):
        for node in ([el] if chain is None else [c[0] for c in reversed(chain)]):
            x = node.find('./p:spPr/a:xfrm', NS)
            if x is None:
                x = node.find('./p:xfrm', NS)
            if x is None:
                x = node.find('./p:grpSpPr/a:xfrm', NS)
            if x is not None and x.find('a:off', NS) is not None:
                o, e = x.find('a:off', NS), x.find('a:ext', NS)
                g = {'x': px(o.get('x')), 'y': px(o.get('y')), 'w': px(e.get('cx')), 'h': px(e.get('cy'))}
                if x.get('rot'):
                    g['rot'] = int(x.get('rot')) / 60000
                if x.get('flipH') == '1':
                    g['flipH'] = True
                if x.get('flipV') == '1':
                    g['flipV'] = True
                return g
        return None

    def shape_style(self, spPr):
        s = {}
        if spPr is None:
            return s
        geo = spPr.find('a:prstGeom', NS)
        if geo is not None:
            s['geom'] = geo.get('prst')
            gd = geo.find('a:avLst/a:gd', NS)
            if gd is not None and gd.get('fmla', '').startswith('val '):
                s['adj'] = int(gd.get('fmla')[4:]) / 100000
        fill = spPr.find('a:solidFill', NS)
        if fill is not None:
            s['fill'] = self.color(color_of(fill))
        ln = spPr.find('a:ln', NS)
        if ln is not None and ln.find('a:noFill', NS) is None:
            c = color_of(ln.find('a:solidFill', NS))
            stroke = {'w': px(ln.get('w', '9525')), 'color': self.color(c) or '#000000'}
            dash = ln.find('a:prstDash', NS)
            if dash is not None and dash.get('val') != 'solid':
                stroke['dash'] = dash.get('val')
            for end in ('headEnd', 'tailEnd'):
                e = ln.find('a:' + end, NS)
                if e is not None and e.get('type') not in (None, 'none'):
                    stroke[end] = e.get('type')
            s['stroke'] = stroke
        return s

    def image(self, part, rid):
        src = part.rels.get(rid)
        if src is None:
            return None
        name = os.path.basename(src)
        if '&' in name or '?' in name or '.' not in name:
            name = 'image-%d.png' % (len(self.media) + 1)
        self.media[name] = os.path.join(self.dir, src)
        return 'media/' + name

    # ---- shapes --------------------------------------------------------------
    def shape(self, part, el, skip_ph=False):
        tag = el.tag.split('}')[1]
        nv = el.find('.//p:cNvPr', NS)
        name = nv.get('name') if nv is not None else ''
        key = ph_key(el) if tag == 'sp' else None
        if key is not None and skip_ph:
            return None
        chain = self.chain(part, el) if key is not None else None
        geom = self.xfrm(el, chain)
        if geom is None and tag != 'grpSp':
            return None
        out = {'name': name}
        if geom:
            out.update(geom)
        if tag in ('sp', 'cxnSp'):
            style = {}
            for node, _ in (chain or [(el, part)]):
                style.update(self.shape_style(node.find('p:spPr', NS)))
            out['kind'] = 'line' if style.get('geom') in ('line', 'straightConnector1') or tag == 'cxnSp' else 'box'
            out.update(style)
            tx = el.find('p:txBody', NS)
            if tx is not None:
                body, paras = self.text(part, el, tx, key is not None)
                if any(r.get('t') for p in paras for r in p['runs']):
                    out['body'] = body
                    out['paras'] = paras
            if key is not None:
                out['placeholder'] = key[0]
        elif tag == 'pic':
            out['kind'] = 'image'
            blip = el.find('.//a:blip', NS)
            out['src'] = self.image(part, blip.get(q('r:embed')))
            src = el.find('.//a:srcRect', NS)
            if src is not None:
                out['crop'] = {k: int(v) / 100000 for k, v in src.attrib.items()}
            out.update({k: v for k, v in self.shape_style(el.find('p:spPr', NS)).items() if k in ('stroke',)})
        elif tag == 'graphicFrame':
            tbl = el.find('.//a:tbl', NS)
            chart = el.find('.//c:chart', NS)
            if tbl is not None:
                out['kind'] = 'table'
                out['cols'] = [px(g.get('w')) for g in tbl.findall('a:tblGrid/a:gridCol', NS)]
                rows = []
                for tr in tbl.findall('a:tr', NS):
                    cells = []
                    for tc in tr.findall('a:tc', NS):
                        cells.append(self.cell(part, tc))
                    rows.append({'h': px(tr.get('h')), 'cells': cells})
                out['rows'] = rows
            elif chart is not None:
                out['kind'] = 'chart'
                out['chart'] = os.path.basename(part.rels[chart.get(q('r:id'))]).replace('.xml', '')
            else:
                return None
        elif tag == 'grpSp':
            out['kind'] = 'group'
            out['children'] = [c for c in (self.shape(part, ch) for ch in el if ch.tag.split('}')[1] in SHAPE_TAGS) if c]
        return out

    def cell(self, part, tc):
        tcPr = tc.find('a:tcPr', NS)
        c = {}
        tx = tc.find('a:txBody', NS)
        body, paras = self.text(part, tc, tx, False) if tx is not None else ({}, [])
        c['paras'] = paras
        pad = {'l': 91440 / EMU_PX, 'r': 91440 / EMU_PX, 't': 45720 / EMU_PX, 'b': 45720 / EMU_PX}
        if tcPr is not None:
            for k, side in (('marL', 'l'), ('marR', 'r'), ('marT', 't'), ('marB', 'b')):
                if tcPr.get(k) is not None:
                    pad[side] = px(tcPr.get(k))
            c['anchor'] = tcPr.get('anchor', 't')
            fill = tcPr.find('a:solidFill', NS)
            if fill is not None:
                c['fill'] = self.color(color_of(fill))
            for side, tag in (('top', 'lnT'), ('bottom', 'lnB'), ('left', 'lnL'), ('right', 'lnR')):
                ln = tcPr.find('a:' + tag, NS)
                if ln is not None and ln.find('a:noFill', NS) is None:
                    col = color_of(ln.find('a:solidFill', NS))
                    if col:
                        c['border_' + side] = {'w': px(ln.get('w', '9525')), 'color': self.color(col)}
        c['pad'] = pad
        return c

    def slide(self, path, number):
        part = self.part(path)
        layout = self.part(part.parent_path())
        master = self.part(layout.parent_path())
        bg = None
        for p in (master, layout, part):
            b = p.root.find('.//p:bg//a:solidFill', NS)
            if b is not None:
                bg = self.color(color_of(b))
        shapes = []
        # Decorative (non-placeholder) shapes from master and layout come first.
        show_master = layout.root.get('showMasterSp') != '0' and part.root.get('showMasterSp') != '0'
        layers = ([master] if show_master else []) + [layout]
        for layer in layers:
            tree = layer.root.find('.//p:spTree', NS)
            for el in tree:
                if el.tag.split('}')[1] in SHAPE_TAGS:
                    s = self.shape(layer, el, skip_ph=True)
                    if s:
                        shapes.append(s)
        tree = part.root.find('.//p:spTree', NS)
        for el in tree:
            if el.tag.split('}')[1] in SHAPE_TAGS:
                s = self.shape(part, el)
                if s:
                    shapes.append(s)
        for s in shapes:
            for p in s.get('paras', []):
                for r in p['runs']:
                    if r.get('field') == 'slidenum':
                        r['t'] = str(number)
        return {'n': number, 'bg': bg or '#FFFFFF', 'shapes': shapes}


def main():
    pptx, out, media_dir = sys.argv[1:4]
    tmp = tempfile.mkdtemp()
    with zipfile.ZipFile(pptx) as z:
        z.extractall(tmp)
    deck = Deck(tmp)
    pres = ET.parse(os.path.join(tmp, 'ppt/presentation.xml')).getroot()
    pres_rels = Part(tmp, 'ppt/presentation.xml').rels
    slides = []
    for i, sid in enumerate(pres.findall('.//p:sldIdLst/p:sldId', NS), start=1):
        slides.append(deck.slide(pres_rels[sid.get(q('r:id'))], i))
    with open(out, 'w', encoding='utf-8') as f:
        json.dump({'width': 1920, 'height': 1080, 'slides': slides}, f, ensure_ascii=False, indent=1)
    os.makedirs(media_dir, exist_ok=True)
    for name, src in deck.media.items():
        shutil.copyfile(src, os.path.join(media_dir, name))
    print('slides:', len(slides), 'media:', sorted(deck.media))


if __name__ == '__main__':
    main()
