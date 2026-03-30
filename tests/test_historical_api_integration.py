"""
Integration tests for Cato Historical Analysis API endpoints.

Tests the Phase 3 implementation that integrates Marcus's Phase 1 & 2
analysis modules into Cato's backend API.

These tests require Marcus to be installed and available.
They are skipped in CI where Marcus is not present.
"""

import pytest
from fastapi.testclient import TestClient

# Check if Marcus historical mode is available
try:
    from backend.api import HISTORICAL_MODE_AVAILABLE
except ImportError:
    HISTORICAL_MODE_AVAILABLE = False

requires_marcus = pytest.mark.skipif(
    not HISTORICAL_MODE_AVAILABLE,
    reason="Marcus is not installed - historical mode unavailable",
)


@pytest.fixture
def client():
    """
    Create a FastAPI test client for the Cato backend.

    Returns
    -------
    TestClient
        Test client for making HTTP requests
    """
    # Import here to avoid import errors during collection
    from backend.api import app

    return TestClient(app)


@requires_marcus
class TestHistoricalProjectsEndpoint:
    """Test suite for /api/historical/projects endpoint."""

    def test_projects_endpoint_returns_200(self, client):
        """
        Test that the historical projects endpoint returns 200 OK.

        This verifies that Marcus modules are imported successfully
        and the endpoint is accessible.
        """
        response = client.get("/api/historical/projects")
        assert response.status_code == 200

    def test_projects_endpoint_returns_list(self, client):
        """
        Test that the endpoint returns a list of projects.

        Expected response format:
        {
            "projects": [
                {
                    "project_id": str,
                    "project_name": str,
                    "total_tasks": int,
                    "completed_tasks": int,
                    ...
                }
            ]
        }
        """
        response = client.get("/api/historical/projects")
        data = response.json()

        assert "projects" in data
        assert isinstance(data["projects"], list)

    def test_projects_have_required_fields(self, client):
        """
        Test that each project has all required fields.

        Required fields per project:
        - project_id
        - project_name
        - total_tasks
        - completed_tasks
        - blocked_tasks
        - completion_rate
        - total_decisions
        - total_artifacts
        - active_agents
        - project_duration_hours
        """
        response = client.get("/api/historical/projects")
        data = response.json()
        projects = data["projects"]

        if len(projects) == 0:
            pytest.skip("No projects in database")

        required_fields = {
            "project_id",
            "project_name",
            "total_tasks",
            "completed_tasks",
            "blocked_tasks",
            "completion_rate",
            "total_decisions",
            "total_artifacts",
            "active_agents",
            "project_duration_hours",
        }

        first_project = projects[0]
        assert required_fields.issubset(
            first_project.keys()
        ), f"Missing fields: {required_fields - first_project.keys()}"

    def test_projects_have_valid_types(self, client):
        """Test that project fields have correct data types."""
        response = client.get("/api/historical/projects")
        data = response.json()
        projects = data["projects"]

        if len(projects) == 0:
            pytest.skip("No projects in database")

        project = projects[0]

        assert isinstance(project["project_id"], str)
        assert isinstance(project["project_name"], str)
        assert isinstance(project["total_tasks"], int)
        assert isinstance(project["completed_tasks"], int)
        assert isinstance(project["blocked_tasks"], int)
        assert isinstance(project["completion_rate"], (int, float))
        assert isinstance(project["total_decisions"], int)
        assert isinstance(project["total_artifacts"], int)
        assert isinstance(project["active_agents"], int)
        assert isinstance(project["project_duration_hours"], (int, float))

    def test_completion_rate_is_valid_percentage(self, client):
        """Test that completion rate is between 0 and 100."""
        response = client.get("/api/historical/projects")
        data = response.json()
        projects = data["projects"]

        if len(projects) == 0:
            pytest.skip("No projects in database")

        for project in projects:
            rate = project["completion_rate"]
            assert 0 <= rate <= 100, f"Invalid completion rate: {rate}"


@requires_marcus
class TestHistoricalModeAvailability:
    """Test suite for historical mode availability flag."""

    def test_historical_mode_enabled_in_response(self, client):
        """
        Test that the API indicates historical mode is available.

        When Marcus modules are imported successfully, responses should
        include information about historical mode availability.
        """
        # Test health endpoint or a dedicated status endpoint
        # For now, we verify by checking that historical endpoints work
        response = client.get("/api/historical/projects")
        assert response.status_code == 200, "Historical mode should be available"


class TestHistoricalApiErrorHandling:
    """Test suite for error handling in historical API."""

    def test_invalid_project_id_returns_appropriate_error(self, client):
        """
        Test that invalid project IDs return appropriate error responses.

        Note: This tests a hypothetical project detail endpoint.
        Adjust based on actual API design.
        """
        # If project detail endpoint exists:
        # response = client.get("/api/historical/projects/invalid-id")
        # assert response.status_code in [400, 404]
        pass  # Placeholder for when project detail endpoint is implemented

    def test_api_handles_marcus_unavailability_gracefully(self, client):
        """
        Test that if Marcus is unavailable, API returns graceful error.

        This is a conceptual test - in practice, we'd need to mock
        Marcus imports to fail.
        """
        # This would require mocking Marcus module imports
        # For now, just verify the endpoint exists
        response = client.get("/api/historical/projects")
        assert response.status_code in [
            200,
            503,
        ], "Should return 200 (working) or 503 (unavailable)"
