"""
End-to-end functional tests for the collaboration feature.

Tests: user handles, invitations, role management, collaborator lifecycle,
access enforcement. All test artifacts (users, infospaces) are cleaned up
on module teardown — no ghost records.

Requires: Postgres (via docker compose).
"""
import pytest
import uuid

from app.core.config import settings

API = settings.API_V1_STR


# ─── Fixtures ─────────────────────────────────────────────────────────────────
# client, auth, headers, user_id, infospace_factory — from conftest.py


@pytest.fixture(scope="module")
def workspace(infospace_factory, user_id):
    """Dedicated infospace for collaboration tests — auto-deleted on teardown."""
    return infospace_factory("Collab Test Workspace", user_id)


@pytest.fixture(scope="module")
def user_factory(client, headers):
    """Factory that creates test users (via admin endpoint) and deletes them on teardown.

    Returns (user_dict, password) so tests can authenticate as the created user.
    """
    created: list[int] = []

    def _create(name: str, email: str | None = None, handle: str | None = None) -> tuple[dict, str]:
        email = email or f"test-{uuid.uuid4().hex[:8]}@collab-test.local"
        password = f"TestPass-{uuid.uuid4().hex[:8]}!"
        payload = {
            "email": email,
            "password": password,
            "full_name": name,
            "is_superuser": False,
            "is_active": True,
            "send_welcome_email": False,
        }
        if handle:
            payload["handle"] = handle
        r = client.post(f"{API}/users", headers=headers, json=payload)
        assert r.status_code == 200, f"User creation failed: {r.text[:300]}"
        user = r.json()
        created.append(user["id"])
        return user, password

    yield _create

    # Teardown — delete all created users (reverse order, superuser auth)
    for uid in reversed(created):
        client.delete(f"{API}/users/{uid}", headers=headers)


def _login(client, email: str, password: str) -> dict:
    """Authenticate as a user and return auth headers."""
    r = client.post(
        f"{API}/login/access-token",
        data={"username": email, "password": password},
    )
    assert r.status_code == 200, f"Login failed for {email}: {r.text[:200]}"
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ═══════════════════════════════════════════════════
# Handles
# ═══════════════════════════════════════════════════

class TestHandles:

    def test_superuser_has_handle(self, client, headers):
        """Superuser (seeded) should have an auto-generated handle."""
        r = client.get(f"{API}/users/me", headers=headers)
        assert r.status_code == 200
        # handle may or may not exist for pre-existing superuser depending
        # on whether migration ran; just check the field is present
        assert "handle" in r.json()

    def test_created_user_gets_handle(self, user_factory):
        """Admin-created users get auto-generated handles."""
        user, _ = user_factory("Handle Test User")
        assert user["handle"] is not None
        assert len(user["handle"]) >= 3

    def test_handle_check_available(self, client):
        """Public endpoint checks handle availability."""
        unique = f"test-avail-{uuid.uuid4().hex[:6]}"
        r = client.get(f"{API}/users/handles/check", params={"handle": unique})
        assert r.status_code == 200
        assert r.json()["available"] is True

    def test_handle_check_taken(self, client, user_factory):
        """Taken handle reports unavailable."""
        user, _ = user_factory("Taken Handle")
        r = client.get(f"{API}/users/handles/check", params={"handle": user["handle"]})
        assert r.status_code == 200
        assert r.json()["available"] is False

    def test_handle_check_invalid_format(self, client):
        """Invalid handles report unavailable."""
        r = client.get(f"{API}/users/handles/check", params={"handle": "ab"})  # too short
        assert r.status_code == 200
        assert r.json()["available"] is False

    def test_change_handle(self, client, user_factory):
        """User can change their own handle."""
        user, pw = user_factory("Change Handle")
        h = _login(client, user["email"], pw)
        new_handle = f"changed-{uuid.uuid4().hex[:6]}"
        r = client.patch(f"{API}/users/me/handle", headers=h, json={"handle": new_handle})
        assert r.status_code == 200
        assert r.json()["handle"] == new_handle

    def test_change_handle_to_taken(self, client, user_factory):
        """Changing handle to one already taken fails."""
        user_a, _ = user_factory("Handle Owner A")
        user_b, pw_b = user_factory("Handle Owner B")
        h = _login(client, user_b["email"], pw_b)
        r = client.patch(f"{API}/users/me/handle", headers=h, json={"handle": user_a["handle"]})
        assert r.status_code == 400
        assert "taken" in r.json()["detail"].lower()

    def test_search_by_handle(self, client, headers, user_factory):
        """Authenticated search finds users by handle prefix."""
        unique = f"searchtest-{uuid.uuid4().hex[:6]}"
        user_factory("Searchable User", handle=unique)
        r = client.get(f"{API}/users/handles/search", headers=headers, params={"q": unique[:8]})
        assert r.status_code == 200
        handles = [u["handle"] for u in r.json()]
        assert unique in handles

    def test_search_excludes_self(self, client, user_factory):
        """Search results exclude the requesting user."""
        user, pw = user_factory("Self Excluder")
        h = _login(client, user["email"], pw)
        r = client.get(f"{API}/users/handles/search", headers=h, params={"q": user["handle"][:5]})
        assert r.status_code == 200
        ids = [u["id"] for u in r.json()]
        assert user["id"] not in ids

    def test_search_requires_auth(self, client):
        """Unauthenticated search is rejected."""
        r = client.get(f"{API}/users/handles/search", params={"q": "test"})
        assert r.status_code == 401


# ═══════════════════════════════════════════════════
# Invitations
# ═══════════════════════════════════════════════════

class TestInvitations:

    def test_invite_by_handle(self, client, headers, workspace, user_factory):
        """Owner can invite a user by handle."""
        invitee, _ = user_factory("Invite By Handle")
        r = client.post(
            f"{API}/infospaces/{workspace}/invitations", headers=headers,
            json={"identifier": invitee["handle"], "role": "viewer"},
        )
        assert r.status_code == 201
        body = r.json()
        assert body["status"] == "pending"
        assert body["role"] == "viewer"
        assert body["invitee_handle"] == invitee["handle"]

    def test_invite_by_email(self, client, headers, workspace, user_factory):
        """Owner can invite a user by email."""
        invitee, _ = user_factory("Invite By Email")
        r = client.post(
            f"{API}/infospaces/{workspace}/invitations", headers=headers,
            json={"identifier": invitee["email"], "role": "analyst"},
        )
        assert r.status_code == 201
        assert r.json()["role"] == "analyst"

    def test_invite_nonexistent_email(self, client, headers, workspace):
        """Inviting a non-existent email creates a pending email-keyed invitation."""
        email = f"future-{uuid.uuid4().hex[:8]}@collab-test.local"
        r = client.post(
            f"{API}/infospaces/{workspace}/invitations", headers=headers,
            json={"identifier": email, "role": "curator"},
        )
        assert r.status_code == 201
        body = r.json()
        assert body["status"] == "pending"
        assert body["invitee_email"] == email
        assert body["invitee_handle"] is None

    def test_invite_owner_rejected(self, client, headers, workspace):
        """Cannot invite the infospace owner."""
        me = client.get(f"{API}/users/me", headers=headers).json()
        r = client.post(
            f"{API}/infospaces/{workspace}/invitations", headers=headers,
            json={"identifier": me["handle"] or me["email"], "role": "viewer"},
        )
        assert r.status_code == 400
        assert "owner" in r.json()["detail"].lower()

    def test_invite_as_owner_role_rejected(self, client, headers, workspace, user_factory):
        """Cannot invite someone as 'owner'."""
        invitee, _ = user_factory("Bad Role Invite")
        r = client.post(
            f"{API}/infospaces/{workspace}/invitations", headers=headers,
            json={"identifier": invitee["handle"], "role": "owner"},
        )
        assert r.status_code == 400

    def test_duplicate_invite_updates_role(self, client, headers, workspace, user_factory):
        """Re-inviting an already-pending user updates the role."""
        invitee, _ = user_factory("Dup Invite")
        client.post(
            f"{API}/infospaces/{workspace}/invitations", headers=headers,
            json={"identifier": invitee["handle"], "role": "viewer"},
        )
        r = client.post(
            f"{API}/infospaces/{workspace}/invitations", headers=headers,
            json={"identifier": invitee["handle"], "role": "analyst"},
        )
        assert r.status_code == 201
        assert r.json()["role"] == "analyst"

    def test_list_infospace_invitations(self, client, headers, workspace, user_factory):
        """Owner can list all invitations for an infospace."""
        invitee, _ = user_factory("List Inv User")
        client.post(
            f"{API}/infospaces/{workspace}/invitations", headers=headers,
            json={"identifier": invitee["handle"], "role": "viewer"},
        )
        r = client.get(f"{API}/infospaces/{workspace}/invitations", headers=headers)
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_revoke_invitation(self, client, headers, workspace, user_factory):
        """Owner can revoke a pending invitation."""
        invitee, _ = user_factory("Revoke Target")
        inv = client.post(
            f"{API}/infospaces/{workspace}/invitations", headers=headers,
            json={"identifier": invitee["handle"], "role": "viewer"},
        ).json()
        r = client.delete(f"{API}/infospaces/{workspace}/invitations/{inv['id']}", headers=headers)
        assert r.status_code == 200

    def test_nonowner_cannot_invite(self, client, headers, workspace, user_factory):
        """A viewer cannot send invitations (requires SETUP capability)."""
        # Create a viewer collaborator directly via invitation + accept
        viewer, pw_v = user_factory("No Invite Power")
        inv = client.post(
            f"{API}/infospaces/{workspace}/invitations", headers=headers,
            json={"identifier": viewer["handle"], "role": "viewer"},
        ).json()
        viewer_h = _login(client, viewer["email"], pw_v)
        client.post(f"{API}/users/me/invitations/{inv['id']}/accept", headers=viewer_h)

        # Now the viewer tries to invite someone else
        target, _ = user_factory("Invite Target")
        r = client.post(
            f"{API}/infospaces/{workspace}/invitations", headers=viewer_h,
            json={"identifier": target["handle"], "role": "viewer"},
        )
        assert r.status_code == 403


# ═══════════════════════════════════════════════════
# Invitation Inbox (user-scoped)
# ═══════════════════════════════════════════════════

class TestInvitationInbox:

    def test_accept_invitation(self, client, headers, user_id, infospace_factory, user_factory):
        """Accepting creates an InfospaceCollaborator and the infospace appears in the user's list."""
        iid = infospace_factory("Accept Test WS", user_id)
        invitee, pw = user_factory("Accepter")
        inv = client.post(
            f"{API}/infospaces/{iid}/invitations", headers=headers,
            json={"identifier": invitee["handle"], "role": "analyst"},
        ).json()

        invitee_h = _login(client, invitee["email"], pw)

        # Check inbox count
        count = client.get(f"{API}/users/me/invitations/count", headers=invitee_h).json()
        assert count["count"] >= 1

        # Check inbox list
        inbox = client.get(f"{API}/users/me/invitations", headers=invitee_h).json()
        inv_ids = [i["id"] for i in inbox]
        assert inv["id"] in inv_ids

        # Accept
        r = client.post(f"{API}/users/me/invitations/{inv['id']}/accept", headers=invitee_h)
        assert r.status_code == 200
        assert r.json()["infospace_id"] == iid
        assert r.json()["role"] == "analyst"

        # Verify collaborator appears in list
        collabs = client.get(f"{API}/infospaces/{iid}/collaborators", headers=headers).json()
        collab_ids = [c["user_id"] for c in collabs]
        assert invitee["id"] in collab_ids

        # Count should be decremented
        count2 = client.get(f"{API}/users/me/invitations/count", headers=invitee_h).json()
        assert count2["count"] < count["count"]

    def test_decline_invitation(self, client, headers, user_id, infospace_factory, user_factory):
        """Declining does not create a collaborator."""
        iid = infospace_factory("Decline Test WS", user_id)
        invitee, pw = user_factory("Decliner")
        inv = client.post(
            f"{API}/infospaces/{iid}/invitations", headers=headers,
            json={"identifier": invitee["handle"], "role": "viewer"},
        ).json()

        invitee_h = _login(client, invitee["email"], pw)
        r = client.post(f"{API}/users/me/invitations/{inv['id']}/decline", headers=invitee_h)
        assert r.status_code == 200

        # Should NOT appear in collaborator list
        collabs = client.get(f"{API}/infospaces/{iid}/collaborators", headers=headers).json()
        collab_ids = [c["user_id"] for c in collabs]
        assert invitee["id"] not in collab_ids

    def test_accept_wrong_user_rejected(self, client, headers, user_id, infospace_factory, user_factory):
        """A user cannot accept someone else's invitation."""
        iid = infospace_factory("Wrong Accept WS", user_id)
        real_invitee, _ = user_factory("Real Invitee")
        imposter, pw_imp = user_factory("Imposter")

        inv = client.post(
            f"{API}/infospaces/{iid}/invitations", headers=headers,
            json={"identifier": real_invitee["handle"], "role": "viewer"},
        ).json()

        imposter_h = _login(client, imposter["email"], pw_imp)
        r = client.post(f"{API}/users/me/invitations/{inv['id']}/accept", headers=imposter_h)
        assert r.status_code == 400

    def test_double_accept_rejected(self, client, headers, user_id, infospace_factory, user_factory):
        """Cannot accept the same invitation twice."""
        iid = infospace_factory("Double Accept WS", user_id)
        invitee, pw = user_factory("Double Accepter")
        inv = client.post(
            f"{API}/infospaces/{iid}/invitations", headers=headers,
            json={"identifier": invitee["handle"], "role": "curator"},
        ).json()

        invitee_h = _login(client, invitee["email"], pw)
        client.post(f"{API}/users/me/invitations/{inv['id']}/accept", headers=invitee_h)
        r = client.post(f"{API}/users/me/invitations/{inv['id']}/accept", headers=invitee_h)
        assert r.status_code == 400


# ═══════════════════════════════════════════════════
# Collaborator Management
# ═══════════════════════════════════════════════════

class TestCollaboratorManagement:

    def test_list_collaborators_includes_owner(self, client, headers, workspace):
        """Collaborator list always includes the owner."""
        r = client.get(f"{API}/infospaces/{workspace}/collaborators", headers=headers)
        assert r.status_code == 200
        owners = [c for c in r.json() if c["is_owner"]]
        assert len(owners) == 1

    def test_change_role(self, client, headers, user_id, infospace_factory, user_factory):
        """Owner can change a collaborator's role."""
        iid = infospace_factory("Role Change WS", user_id)
        collab, pw = user_factory("Role Changer")

        # Invite + accept as viewer
        inv = client.post(
            f"{API}/infospaces/{iid}/invitations", headers=headers,
            json={"identifier": collab["handle"], "role": "viewer"},
        ).json()
        collab_h = _login(client, collab["email"], pw)
        client.post(f"{API}/users/me/invitations/{inv['id']}/accept", headers=collab_h)

        # Change to analyst
        r = client.patch(
            f"{API}/infospaces/{iid}/collaborators/{collab['id']}/role",
            headers=headers, params={"role": "analyst"},
        )
        assert r.status_code == 200

        # Verify in list
        collabs = client.get(f"{API}/infospaces/{iid}/collaborators", headers=headers).json()
        match = [c for c in collabs if c["user_id"] == collab["id"]]
        assert len(match) == 1
        assert match[0]["role"] == "analyst"

    def test_remove_collaborator(self, client, headers, user_id, infospace_factory, user_factory):
        """Owner can remove a collaborator."""
        iid = infospace_factory("Remove Collab WS", user_id)
        collab, pw = user_factory("Removable")

        inv = client.post(
            f"{API}/infospaces/{iid}/invitations", headers=headers,
            json={"identifier": collab["handle"], "role": "viewer"},
        ).json()
        collab_h = _login(client, collab["email"], pw)
        client.post(f"{API}/users/me/invitations/{inv['id']}/accept", headers=collab_h)

        # Remove
        r = client.delete(f"{API}/infospaces/{iid}/collaborators/{collab['id']}", headers=headers)
        assert r.status_code == 200

        # Verify gone
        collabs = client.get(f"{API}/infospaces/{iid}/collaborators", headers=headers).json()
        collab_ids = [c["user_id"] for c in collabs]
        assert collab["id"] not in collab_ids

    def test_leave_infospace(self, client, headers, user_id, infospace_factory, user_factory):
        """A collaborator can leave an infospace."""
        iid = infospace_factory("Leave WS", user_id)
        collab, pw = user_factory("Leaver")

        inv = client.post(
            f"{API}/infospaces/{iid}/invitations", headers=headers,
            json={"identifier": collab["handle"], "role": "analyst"},
        ).json()
        collab_h = _login(client, collab["email"], pw)
        client.post(f"{API}/users/me/invitations/{inv['id']}/accept", headers=collab_h)

        # Leave
        r = client.delete(f"{API}/infospaces/{iid}/collaborators/me", headers=collab_h)
        assert r.status_code == 200

    def test_owner_cannot_leave(self, client, headers, user_id, infospace_factory):
        """Owner cannot leave their own infospace."""
        iid = infospace_factory("Owner Stay WS", user_id)
        r = client.delete(f"{API}/infospaces/{iid}/collaborators/me", headers=headers)
        assert r.status_code == 400

    def test_invite_existing_collaborator_rejected(self, client, headers, user_id, infospace_factory, user_factory):
        """Cannot invite someone who is already a collaborator."""
        iid = infospace_factory("Already Collab WS", user_id)
        collab, pw = user_factory("Already In")

        inv = client.post(
            f"{API}/infospaces/{iid}/invitations", headers=headers,
            json={"identifier": collab["handle"], "role": "viewer"},
        ).json()
        collab_h = _login(client, collab["email"], pw)
        client.post(f"{API}/users/me/invitations/{inv['id']}/accept", headers=collab_h)

        # Try to invite again
        r = client.post(
            f"{API}/infospaces/{iid}/invitations", headers=headers,
            json={"identifier": collab["handle"], "role": "analyst"},
        )
        assert r.status_code == 400
        assert "already" in r.json()["detail"].lower()


# ═══════════════════════════════════════════════════
# Collaborator Access Enforcement
# ═══════════════════════════════════════════════════

class TestCollaboratorAccess:

    def test_viewer_can_read(self, client, headers, user_id, infospace_factory, user_factory):
        """A viewer collaborator can read infospace data."""
        iid = infospace_factory("Viewer Read WS", user_id)
        viewer, pw = user_factory("Viewer Reader")

        inv = client.post(
            f"{API}/infospaces/{iid}/invitations", headers=headers,
            json={"identifier": viewer["handle"], "role": "viewer"},
        ).json()
        viewer_h = _login(client, viewer["email"], pw)
        client.post(f"{API}/users/me/invitations/{inv['id']}/accept", headers=viewer_h)

        # Viewer can read infospace
        r = client.get(f"{API}/infospaces/{iid}", headers=viewer_h)
        assert r.status_code == 200

        # Viewer can list collaborators
        r = client.get(f"{API}/infospaces/{iid}/collaborators", headers=viewer_h)
        assert r.status_code == 200

    def test_viewer_cannot_write(self, client, headers, user_id, infospace_factory, user_factory):
        """A viewer cannot create bundles (requires ORGANIZE capability)."""
        iid = infospace_factory("Viewer Write WS", user_id)
        viewer, pw = user_factory("Viewer Writer")

        inv = client.post(
            f"{API}/infospaces/{iid}/invitations", headers=headers,
            json={"identifier": viewer["handle"], "role": "viewer"},
        ).json()
        viewer_h = _login(client, viewer["email"], pw)
        client.post(f"{API}/users/me/invitations/{inv['id']}/accept", headers=viewer_h)

        r = client.post(
            f"{API}/infospaces/{iid}/bundles", headers=viewer_h,
            json={"name": "Forbidden Bundle"},
        )
        assert r.status_code == 403

    def test_analyst_can_ingest(self, client, headers, user_id, infospace_factory, user_factory):
        """An analyst can ingest assets."""
        iid = infospace_factory("Analyst Ingest WS", user_id)
        analyst, pw = user_factory("Analyst Ingester")

        inv = client.post(
            f"{API}/infospaces/{iid}/invitations", headers=headers,
            json={"identifier": analyst["handle"], "role": "analyst"},
        ).json()
        analyst_h = _login(client, analyst["email"], pw)
        client.post(f"{API}/users/me/invitations/{inv['id']}/accept", headers=analyst_h)

        r = client.post(
            f"{API}/infospaces/{iid}/assets/ingest-text", headers=analyst_h,
            params={"text_content": "Analyst ingested this.", "title": "Analyst Note"},
        )
        assert r.status_code == 200

    def test_nonmember_cannot_access(self, client, user_id, infospace_factory, user_factory):
        """A user who is not a member cannot access the infospace."""
        iid = infospace_factory("No Access WS", user_id)
        outsider, pw = user_factory("Outsider")
        outsider_h = _login(client, outsider["email"], pw)

        r = client.get(f"{API}/infospaces/{iid}", headers=outsider_h)
        assert r.status_code == 404  # 404, not 403 — don't reveal existence


# ═══════════════════════════════════════════════════
# Handle Generator (unit test)
# ═══════════════════════════════════════════════════

class TestHandleGenerator:
    """Unit tests for the handle generation logic — no DB needed."""

    def test_validate_good_handles(self):
        from app.api.modules.identity_infospace_user.handle_gen import validate_handle
        assert validate_handle("swift-falcon") == "swift-falcon"
        assert validate_handle("user123") == "user123"
        assert validate_handle("a-b") == "a-b"
        assert validate_handle("ABC") == "abc"  # lowercased

    def test_validate_rejects_bad_handles(self):
        from app.api.modules.identity_infospace_user.handle_gen import validate_handle
        import pytest as pt
        for bad in ["ab", "-start", "end-", "has space", "special!char", ""]:
            with pt.raises(ValueError):
                validate_handle(bad)

    def test_word_lists_populated(self):
        from app.api.modules.identity_infospace_user.handle_gen import ADJECTIVES, NOUNS
        assert len(ADJECTIVES) >= 50
        assert len(NOUNS) >= 50
