
async fn handle_autofill_suggestions(
    Extension(graph): Extension<Graph>,
    Extension(claims): Extension<auth::Claims>,
    Json(request): Json<autofill::AutofillRequest>,
) -> Result<Json<autofill::AutofillResponse>, (StatusCode, String)> {
    autofill::get_autofill_suggestions(graph, claims.sub, request).await
}
