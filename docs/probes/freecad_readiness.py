"""Disposable readiness experiment, NOT the production Worker or transaction engine.

Run with any Python; --runtime-root is an extracted FreeCAD AppImage root.
All CAD files and child logs go under a NEW --output directory.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import signal
import struct
import subprocess
import sys
import time


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cad_child(action, root, out):
    sys.path.insert(0, str(root / "usr/lib"))
    import FreeCAD as App
    import Part
    import Sketcher

    def check(doc, diameter):
        doc.recompute()
        assert all("Invalid" not in obj.State for obj in doc.Objects)
        assert doc.BaseSketch.FullyConstrained and doc.HoleSketch.FullyConstrained
        shape = doc.Body.Tip.Shape
        assert not shape.isNull() and shape.isValid() and len(shape.Solids) == 1
        expected = 80 * 60 * 10 - math.pi * (diameter / 2) ** 2 * 10
        assert abs(shape.Volume - expected) < 1e-6
        assert abs(shape.BoundBox.XLength - 80) < 1e-6
        assert abs(shape.BoundBox.YLength - 60) < 1e-6
        assert abs(shape.BoundBox.ZLength - 10) < 1e-6
        return {"volume_mm3": shape.Volume, "solids": len(shape.Solids),
                "valid": shape.isValid(), "hole_diameter_mm": diameter,
                "features": {o.Name: o.TypeId for o in doc.Objects
                             if o.TypeId in ("PartDesign::Body", "Sketcher::SketchObject",
                                             "PartDesign::Pad", "PartDesign::Pocket")},
                "fully_constrained": [doc.BaseSketch.FullyConstrained, doc.HoleSketch.FullyConstrained]}

    if action == "build":
        doc = App.newDocument("Plate")
        body = doc.addObject("PartDesign::Body", "Body")
        sketch = body.newObject("Sketcher::SketchObject", "BaseSketch")
        points = [(0, 0), (80, 0), (80, 60), (0, 60)]
        for i in range(4):
            a, b = points[i], points[(i + 1) % 4]
            sketch.addGeometry(Part.LineSegment(App.Vector(*a, 0), App.Vector(*b, 0)), False)
        for i in range(4):
            sketch.addConstraint(Sketcher.Constraint("Coincident", i, 2, (i + 1) % 4, 1))
            sketch.addConstraint(Sketcher.Constraint("Horizontal" if i % 2 == 0 else "Vertical", i))
        sketch.addConstraint(Sketcher.Constraint("Coincident", 0, 1, -1, 1))
        sketch.addConstraint(Sketcher.Constraint("Distance", 0, 80.0))
        sketch.addConstraint(Sketcher.Constraint("Distance", 1, 60.0))
        doc.recompute()
        pad = body.newObject("PartDesign::Pad", "Pad")
        pad.Profile, pad.Length = sketch, 10
        doc.recompute()
        hole = body.newObject("Sketcher::SketchObject", "HoleSketch")
        hole.Placement.Base = App.Vector(0, 0, 10)
        hole.addGeometry(Part.Circle(App.Vector(20, 15, 0), App.Vector(0, 0, 1), 3), False)
        hole.addConstraint(Sketcher.Constraint("Diameter", 0, 6.0))
        hole.addConstraint(Sketcher.Constraint("DistanceX", 0, 3, 20.0))
        hole.addConstraint(Sketcher.Constraint("DistanceY", 0, 3, 15.0))
        doc.recompute()
        pocket = body.newObject("PartDesign::Pocket", "Pocket")
        pocket.Profile, pocket.Length = hole, 10
        pocket.addProperty("App::PropertyString", "CadFeatureId")
        pocket.CadFeatureId = "probe-pocket-stable-id"
        result = check(doc, 6)
        doc.saveAs(str(out / "canonical.FCStd"))
        result.update(freecad=App.Version(), python=sys.version, occt=Part.OCC_VERSION, gui_up=App.GuiUp)
    else:
        path = out / ("canonical.FCStd" if action in ("reopen", "export") else "candidate.FCStd")
        doc = App.openDocument(str(path))
        assert doc.Pocket.CadFeatureId == "probe-pocket-stable-id"
        if action == "edit":
            doc.HoleSketch.setDatum(0, App.Units.Quantity("8 mm"))
            result = check(doc, 8)
            doc.save()
        elif action == "edit_reopen":
            result = check(doc, 8)
        elif action == "invalid":
            # Oversized hole destroys the entire pad; recompute need not throw.
            doc.HoleSketch.setDatum(0, App.Units.Quantity("500 mm"))
            doc.recompute()
            try:
                check(doc, 500)
            except AssertionError:
                result = {"rejected": True, "pocket_state": list(doc.Pocket.State),
                          "status": doc.Pocket.getStatusString(),
                          "shape_null": doc.Pocket.Shape.isNull(),
                          "solid_count": len(doc.Pocket.Shape.Solids),
                          "volume_mm3": doc.Pocket.Shape.Volume}
            else:
                raise AssertionError("invalid candidate escaped deterministic checks")
        elif action == "crash":
            doc.HoleSketch.setDatum(0, App.Units.Quantity("8 mm"))
            check(doc, 8)
            doc.save()
            (out / "child-ready").write_text("saved candidate")
            os.kill(os.getpid(), signal.SIGKILL)
        elif action == "timeout":
            (out / "child-ready").write_text("candidate open")
            time.sleep(60)
        elif action == "export":
            import Import
            result = check(doc, 6)
            Import.export([doc.Body], str(out / "model.step"))
            imported = App.newDocument("StepRoundTrip")
            Import.insert(str(out / "model.step"), imported.Name)
            imported.recompute()
            shapes = [o.Shape for o in imported.Objects if hasattr(o, "Shape") and len(o.Shape.Solids)]
            assert len(shapes) == 1 and shapes[0].isValid() and len(shapes[0].Solids) == 1
            assert abs(shapes[0].Volume - result["volume_mm3"]) < 1e-6
            result["step_reimport"] = {"valid": True, "volume_mm3": shapes[0].Volume}
            # Explicit tessellation is required by headless glTF export on some builds.
            doc.Body.Shape.tessellate(0.1)
            Import.export([doc.Body], str(out / "preview.glb"))
            raw = (out / "preview.glb").read_bytes()
            magic, version, length = struct.unpack_from("<4sII", raw)
            assert magic == b"glTF" and version == 2 and length == len(raw)
            size, kind = struct.unpack_from("<II", raw, 12)
            assert kind == 0x4E4F534A
            gltf = json.loads(raw[20:20 + size])
            assert gltf["meshes"] and gltf["nodes"]
            primitives = [p for mesh in gltf["meshes"] for p in mesh["primitives"]]
            assert primitives and all(gltf["accessors"][p["attributes"]["POSITION"]]["count"] > 0 for p in primitives)
            positions = [gltf["accessors"][p["attributes"]["POSITION"]] for p in primitives]
            low = [min(a["min"][i] for a in positions) for i in range(3)]
            high = [max(a["max"][i] for a in positions) for i in range(3)]
            assert all(abs(a - b) < 1e-6 for a, b in zip(low, [0, 0, -0.06]))
            assert all(abs(a - b) < 1e-6 for a, b in zip(high, [0.08, 0.01, 0]))
            result["headless_glb"] = {"bytes": len(raw), "meshes": len(gltf["meshes"]),
                                      "position_counts": [a["count"] for a in positions],
                                      "bounds_m": [low, high],
                                      "cad_to_glb": "(x,y,z) mm -> (x,z,-y)/1000 m for this fixture"}
        else:
            result = check(doc, 6)
        App.closeDocument(doc.Name)
    (out / (action + ".json")).write_text(json.dumps(result, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--child", default=None)
    args = parser.parse_args()
    root, out = args.runtime_root.resolve(), args.output.resolve()
    if args.child:
        cad_child(args.child, root, out)
        return
    out.mkdir(parents=True, exist_ok=False)
    env = dict(os.environ)
    for key in ("PYTHONHOME", "PYTHONPATH", "LD_LIBRARY_PATH", "DISPLAY", "WAYLAND_DISPLAY"):
        env.pop(key, None)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    # Keep FreeCAD configuration away from the real user's settings.
    for key in ("HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "FREECAD_USER_HOME"):
        env[key] = str(out / "config")
    results = {"recorded_on": "2026-10-24", "runtime_root": str(root),
               "scope": "readiness probe only; no production Gateway/Worker exists", "cases": {}}
    for action in ("build", "reopen", "edit", "edit_reopen", "invalid", "crash", "timeout", "export"):
        if action in ("edit", "invalid", "crash", "timeout"):
            shutil.copyfile(out / "canonical.FCStd", out / "candidate.FCStd")
        before = sha256(out / "canonical.FCStd") if action != "build" else None
        command = [str(root / "usr/bin/python"), str(Path(__file__).resolve()),
                   "--runtime-root", str(root), "--output", str(out), "--child", action]
        with (out / (action + ".log")).open("w") as log:
            process = subprocess.Popen(command, env=env, stdout=log, stderr=log)
            timed_out = False
            try:
                code = process.wait(timeout=3 if action == "timeout" else 30)
            except subprocess.TimeoutExpired:
                timed_out = True
                process.kill()
                code = process.wait(timeout=5)
        assert code == (-signal.SIGKILL if action in ("crash", "timeout") else 0), (action, code)
        if before:
            assert sha256(out / "canonical.FCStd") == before, action
        if action in ("crash", "timeout"):
            assert (out / "child-ready").exists(), "child did not reach candidate"
            (out / "child-ready").unlink()
            result = {"signal": code, "timed_out": timed_out, "canonical_sha256_unchanged": True}
        else:
            result = json.loads((out / (action + ".json")).read_text())
        results["cases"][action] = result
    results["canonical_sha256"] = sha256(out / "canonical.FCStd")
    (out / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
