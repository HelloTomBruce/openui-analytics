import { datasources } from "@/lib/datasources";
import {
  FILE_SOURCE_MAX_BYTES,
  isSupportedUpload,
  type FileSourceUpload,
} from "@openui-analytics/datasources";

/**
 * POST /api/datasources/:id/file — 文件源上传灌库（multipart/form-data）。
 * 字段名 files（可多个）；单文件 ≤50MB，类型白名单 .csv/.xlsx + 内容嗅探。
 * 完全覆盖语义：重新上传清空全部旧表后重建；失败时旧数据保留。
 * 仅 file 类型数据源可用；成功 201 返回 manifest。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const source = datasources.get(id);
    if (!source) {
      return Response.json({ error: `数据源不存在: ${id}` }, { status: 404 });
    }
    if (source.kind !== "file") {
      return Response.json(
        { error: `数据源 ${id} 不是文件类型，无法上传文件` },
        { status: 400 }
      );
    }

    const form = await request.formData().catch(() => null);
    if (!form) {
      return Response.json(
        { error: "请求必须是 multipart/form-data" },
        { status: 400 }
      );
    }
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return Response.json(
        { error: "缺少上传文件（字段名 files）" },
        { status: 400 }
      );
    }

    const uploads: FileSourceUpload[] = [];
    for (const file of files) {
      if (!isSupportedUpload(file.name)) {
        return Response.json(
          { error: `不支持的文件类型: ${file.name}（仅 .csv / .xlsx）` },
          { status: 400 }
        );
      }
      if (file.size > FILE_SOURCE_MAX_BYTES) {
        return Response.json(
          {
            error: `文件超过大小限制: ${file.name}（上限 ${FILE_SOURCE_MAX_BYTES / 1024 / 1024}MB）`,
          },
          { status: 413 }
        );
      }
      const data = Buffer.from(await file.arrayBuffer());
      const sniffError = sniffContent(file.name, data);
      if (sniffError) {
        return Response.json(
          { error: `${file.name}: ${sniffError}` },
          { status: 400 }
        );
      }
      uploads.push({ name: file.name, data });
    }

    const manifest = await datasources.ingestFiles(id, uploads);
    return Response.json({ manifest }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 400 });
  }
}

/**
 * GET /api/datasources/:id/file — 文件源 manifest（文件与表清单）。
 * 未上传过时 manifest 为 null。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!datasources.get(id)) {
    return Response.json({ error: `数据源不存在: ${id}` }, { status: 404 });
  }
  const manifest = await datasources.filesManifest(id);
  return Response.json({ manifest });
}

/** 内容嗅探：xlsx 必须是 ZIP（PK 头），csv 必须是文本（前 8KB 无 NUL） */
function sniffContent(name: string, data: Buffer): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) {
      return "内容不是合法的 xlsx（缺少 ZIP 文件头）";
    }
    return null;
  }
  if (lower.endsWith(".csv")) {
    const head = data.subarray(0, 8192);
    if (head.includes(0)) {
      return "内容不是合法 CSV 文本（检测到二进制字节）";
    }
    return null;
  }
  return null;
}
