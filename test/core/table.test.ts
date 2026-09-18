import { beforeEach, describe, expect, it } from "vitest";
import { setColorEnabled } from "../../src/core/color.js";
import { renderRows, renderTable, truncate, type Column } from "../../src/core/table.js";

interface Post {
  id: string;
  status: string;
  views: number;
}

const posts: Post[] = [
  { id: "post_9c3e1f", status: "PUBLISHED", views: 1204 },
  { id: "post_11", status: "DRAFT", views: 7 },
];

const columns: Column<Post>[] = [
  { header: "id", value: (row) => row.id },
  { header: "status", value: (row) => row.status },
  { header: "views", value: (row) => row.views },
];

beforeEach(() => {
  setColorEnabled(false);
});

describe("renderTable", () => {
  it("returns an empty string for zero rows", () => {
    expect(renderTable([], columns, { width: 80 })).toBe("");
  });

  it("uppercases headers and separates columns with two spaces", () => {
    const lines = renderTable(posts, columns, { width: 80 }).split("\n");
    expect(lines[0]).toBe("ID           STATUS     VIEWS");
    expect(lines[1]).toBe("post_9c3e1f  PUBLISHED   1204");
    expect(lines[2]).toBe("post_11      DRAFT          7");
  });

  it("right-aligns numeric columns and left-aligns text", () => {
    const lines = renderTable(posts, columns, { width: 80 }).split("\n");
    expect(lines[1].endsWith("1204")).toBe(true);
    expect(lines[2].endsWith("   7")).toBe(true);
  });

  it("never emits trailing whitespace", () => {
    for (const line of renderTable(posts, columns, { width: 200 }).split("\n")) {
      expect(line).toBe(line.replace(/\s+$/, ""));
    }
  });

  it("truncates to the given width", () => {
    const wide: Column<Post>[] = [
      { header: "id", value: (row) => row.id },
      { header: "text", value: () => "a very long body of text that will not fit into forty columns" },
    ];
    for (const line of renderTable(posts, wide, { width: 40 }).split("\n")) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
    expect(renderTable(posts, wide, { width: 40 })).toContain("…");
  });

  it("keeps every column readable at 200 columns", () => {
    const lines = renderTable(posts, columns, { width: 200 }).split("\n");
    expect(lines[1]).toContain("post_9c3e1f");
    expect(lines[1]).toContain("PUBLISHED");
  });

  it("honours an explicit alignment", () => {
    const lines = renderTable(posts, [{ header: "views", value: (row) => row.views, align: "left" }], {
      width: 20,
    }).split("\n");
    expect(lines[1]).toBe("1204");
    expect(lines[2]).toBe("7");
  });

  it("renders empty cells for null and undefined values", () => {
    const lines = renderTable(
      [{ id: "a", status: "", views: 0 }],
      [
        { header: "id", value: (row) => row.id },
        { header: "label", value: () => null },
      ],
      { width: 40 },
    ).split("\n");
    expect(lines[1]).toBe("a");
  });
});

describe("renderRows", () => {
  it("pads ragged rows", () => {
    const rendered = renderRows(["a", "b"], [["1"], ["2", "3"]], { width: 20 });
    expect(rendered.split("\n")).toEqual(["A  B", "1", "2  3"]);
  });

  it("can drop the header row", () => {
    const rendered = renderRows(["a"], [["1"]], { width: 20, header: false });
    expect(rendered).toBe("1");
  });
});

describe("truncate", () => {
  it("leaves short values alone", () => {
    expect(truncate("abc", 5)).toBe("abc");
  });

  it("replaces the tail with an ellipsis", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
  });

  it("collapses to a single ellipsis at width one", () => {
    expect(truncate("abcdef", 1)).toBe("…");
  });

  it("returns nothing at width zero", () => {
    expect(truncate("abcdef", 0)).toBe("");
  });
});
