import { describe, expect, it } from "vitest";
import { ImportError } from "./curl";
import { convertPathParams, importOpenApi } from "./openapi";

const YAML_SPEC = `
openapi: 3.0.3
info:
  title: Pet Store
  description: Pets!
servers:
  - url: https://{region}.pets.dev/v1/
    variables:
      region: { default: eu }
paths:
  /pets:
    get:
      tags: [pets]
      summary: List pets
      parameters:
        - { name: limit, in: query, required: true, schema: { type: integer, example: 10 } }
        - { name: cursor, in: query, schema: { type: string } }
    post:
      tags: [pets]
      operationId: createPet
      requestBody:
        content:
          application/json:
            schema: { $ref: "#/components/schemas/Pet" }
  /pets/{petId}:
    parameters:
      - { name: petId, in: path, required: true, schema: { type: string } }
      - { name: X-Tenant, in: header, schema: { type: string, default: acme } }
    delete:
      tags: [admin, pets]
      summary: Delete a pet
  /health:
    get:
      summary: Health
components:
  schemas:
    Pet:
      type: object
      example: { name: Rex, tag: dog }
`;

describe("importOpenApi", () => {
  it("builds folders by first tag, base URL and requests from a YAML spec", () => {
    const result = importOpenApi(YAML_SPEC);
    expect(result.name).toBe("Pet Store");
    expect(result.description).toBe("Pets!");
    expect(result.folders.map((f) => f.name)).toEqual(["pets", "admin"]);

    const [list, create] = result.folders[0].requests;
    expect(list.name).toBe("List pets");
    expect(list.definition.method).toBe("GET");
    expect(list.definition.url).toBe("https://eu.pets.dev/v1/pets");
    expect(list.definition.params).toEqual([
      { key: "limit", value: "10", enabled: true },
      { key: "cursor", value: "", enabled: false },
    ]);

    expect(create.name).toBe("createPet");
    expect(create.definition.body).toEqual({ type: "json", text: JSON.stringify({ name: "Rex", tag: "dog" }, null, 2) });

    const del = result.folders[1].requests[0];
    expect(del.definition.method).toBe("DELETE");
    expect(del.definition.url).toBe("https://eu.pets.dev/v1/pets/{{petId}}");
    expect(del.definition.headers).toEqual([{ key: "X-Tenant", value: "acme", enabled: true }]);

    expect(result.requests.map((r) => r.name)).toEqual(["Health"]);
  });

  it("accepts JSON and prefers media examples", () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "J" },
      paths: {
        "/orders": {
          post: {
            requestBody: { content: { "application/json": { example: { sku: "A" }, schema: { example: { sku: "B" } } } } },
          },
        },
      },
    };
    const result = importOpenApi(JSON.stringify(spec));
    expect(result.requests[0].name).toBe("POST /orders");
    expect(result.requests[0].definition.url).toBe("/orders");
    expect(JSON.parse((result.requests[0].definition.body as { text: string }).text)).toEqual({ sku: "A" });
  });

  it("rejects non-OpenAPI documents", () => {
    expect(() => importOpenApi("hello: world")).toThrow(ImportError);
    expect(() => importOpenApi("{ not json")).toThrow(ImportError);
  });

  it("converts path params", () => {
    expect(convertPathParams("/a/{id}/b/{other_id}")).toBe("/a/{{id}}/b/{{other_id}}");
  });
});
